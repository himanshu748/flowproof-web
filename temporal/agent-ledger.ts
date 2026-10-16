import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type EvidenceActivityPhase = "select" | "tiger" | "search" | "summary";
export interface EvidenceActivityProvenance {
  kind: "retained-native-receipt-fixture";
  receiptSha256: string;
  source: string;
}
export interface EvidenceReservationInput {
  runId: string;
  workflowId: string;
  inputSha256: string;
  sourceAuditSha256: string;
  provenance: EvidenceActivityProvenance;
}
export interface EvidenceActivityInput extends EvidenceReservationInput {
  activityId: string;
  phase: EvidenceActivityPhase;
}
export class EvidenceLedgerError extends Error {
  readonly code: string;
  readonly retryable = false;
  constructor(code: string, _message?: string) {
    super("The dedicated evidence activity ledger refused this operation.");
    this.name = "EvidenceLedgerError";
    this.code = safeCode(code);
  }
}
export class EvidenceActivityAttemptError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, options: { retryable: boolean }) {
    super("The dedicated evidence activity attempt did not complete.");
    this.name = "EvidenceActivityAttemptError";
    this.code = safeCode(code);
    this.retryable = options.retryable === true;
  }
}
const phases = ["select", "tiger", "search", "summary"] as const;
const safeCode = (code: string) =>
  /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "activity_failed";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const provenanceSchema = z
  .object({
    kind: z.literal("retained-native-receipt-fixture"),
    receiptSha256: hash,
    source: z
      .string()
      .min(1)
      .max(500)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
  })
  .strict();
const reservationInputSchema = z
  .object({
    runId: identity,
    workflowId: identity,
    inputSha256: hash,
    sourceAuditSha256: hash,
    provenance: provenanceSchema,
  })
  .strict();
const activityInputSchema = reservationInputSchema
  .extend({
    activityId: identity,
    phase: z.enum(phases),
  })
  .strict();
const reservationSchema = reservationInputSchema
  .extend({
    version: z.literal(1),
    logicalAllowanceReserved: z.literal(true),
    maximumModelAttempts: z.literal(6),
    maximumSearchAttempts: z.literal(3),
    maximumTigerAttempts: z.literal(3),
    maximumAttemptsPerPhase: z.literal(3),
    scope: z.literal("dedicated-temporal-fixture"),
    reservedAt: z.string().datetime(),
  })
  .strict();
export type EvidenceActivityReservation = z.infer<typeof reservationSchema>;
const bindingSchema = activityInputSchema
  .extend({ version: z.literal(1) })
  .strict();
const attemptSchema = z
  .object({
    version: z.literal(1),
    attempt: z.number().int().min(1).max(3),
    bindingSha256: hash,
    status: z.enum(["completed", "failed"]),
    completedAt: z.string().datetime(),
    retryable: z.boolean(),
    code: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
    responseSha256: hash.optional(),
  })
  .strict();
const startedSchema = z
  .object({
    version: z.literal(1),
    attempt: z.number().int().min(1).max(3),
    bindingSha256: hash,
    startedAt: z.string().datetime(),
  })
  .strict();
const completedSchema = z
  .object({
    version: z.literal(1),
    bindingSha256: hash,
    attempt: z.number().int().min(1).max(3),
    responseSha256: hash,
    response: z.unknown(),
  })
  .strict();

// Canonical JSON binds values, rather than object insertion order. Reject values
// that JSON would silently drop or change before any completion is committed.
function canonical(value: unknown): string {
  const seen = new Set<object>();
  const visit = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || item === null || seen.has(item))
      throw new EvidenceLedgerError("invalid_json");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype
    )
      throw new EvidenceLedgerError("invalid_json");
    seen.add(item);
    const result = Array.isArray(item)
      ? Array.from(item, visit)
      : Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, visit((item as Record<string, unknown>)[key])]),
        );
    seen.delete(item);
    return result;
  };
  const result = JSON.stringify(visit(value));
  if (Buffer.byteLength(result) > 2_097_152)
    throw new EvidenceLedgerError("record_too_large");
  return result;
}
const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";
const isExists = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "EEXIST";
async function syncDirectory(folder: string) {
  const handle = await open(folder, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function readJson(filename: string): Promise<unknown | undefined> {
  try {
    const text = await readFile(filename, "utf8");
    if (Buffer.byteLength(text) > 2_097_152)
      throw new Error("Oversized record");
    return JSON.parse(text);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new EvidenceLedgerError("corrupt_record");
  }
}
async function atomicCreate(
  filename: string,
  value: unknown,
): Promise<boolean> {
  const folder = path.dirname(filename);
  const temporary = path.join(folder, `.pending-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(canonical(value), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, filename);
    } catch (error) {
      if (isExists(error)) return false;
      throw error;
    }
    await syncDirectory(folder);
    return true;
  } catch (error) {
    if (error instanceof EvidenceLedgerError) throw error;
    throw new EvidenceLedgerError("persistence_failed");
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new EvidenceLedgerError("corrupt_or_invalid_record");
  return result.data;
}
function same(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected))
    throw new EvidenceLedgerError("identity_mismatch");
}

/** Local, dedicated retained-receipt fixture only. No live provider allowance. */
export function createEvidenceActivityLedger(options: {
  root: string;
  now?: () => number;
}) {
  const root = path.resolve(options.root);
  const now = options.now ?? Date.now;
  const timestamp = () => new Date(now()).toISOString();
  const directory = (runId: string) =>
    path.join(root, sha(parse(identity, runId)));
  const loadReservation = async (runId: string) => {
    const value = await readJson(
      path.join(directory(runId), "reservation.json"),
    );
    if (value === undefined)
      throw new EvidenceLedgerError("allowance_not_reserved");
    const reservation = parse(reservationSchema, value);
    if (reservation.runId !== runId)
      throw new EvidenceLedgerError("identity_mismatch");
    return reservation;
  };
  const loadBinding = async (runId: string, phase: EvidenceActivityPhase) => {
    parse(z.enum(phases), phase);
    const reservation = await loadReservation(runId);
    const value = await readJson(
      path.join(directory(runId), `${phase}.binding.json`),
    );
    if (value === undefined) return undefined;
    const binding = parse(bindingSchema, value);
    same(
      {
        runId: binding.runId,
        workflowId: binding.workflowId,
        sourceAuditSha256: binding.sourceAuditSha256,
        provenance: binding.provenance,
        phase: binding.phase,
      },
      {
        runId,
        workflowId: reservation.workflowId,
        sourceAuditSha256: reservation.sourceAuditSha256,
        provenance: reservation.provenance,
        phase,
      },
    );
    return binding;
  };
  const attempts = async (
    runId: string,
    phase: EvidenceActivityPhase,
    bindingSha256: string,
  ) => {
    const records: z.infer<typeof attemptSchema>[] = [];
    let gap = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const prefix = path.join(directory(runId), `${phase}.attempt-${attempt}`);
      const started = await readJson(`${prefix}.started.json`);
      const finished = await readJson(`${prefix}.json`);
      if (started === undefined && finished === undefined) {
        gap = true;
        continue;
      }
      if (gap || started === undefined)
        throw new EvidenceLedgerError("corrupt_attempt_sequence");
      const beginning = parse(startedSchema, started);
      if (
        beginning.attempt !== attempt ||
        beginning.bindingSha256 !== bindingSha256
      )
        throw new EvidenceLedgerError("identity_mismatch");
      if (finished === undefined)
        throw new EvidenceLedgerError("ambiguous_inflight");
      const result = parse(attemptSchema, finished);
      if (
        result.attempt !== attempt ||
        result.bindingSha256 !== bindingSha256 ||
        (result.status === "completed" &&
          (!result.responseSha256 || result.retryable || result.code)) ||
        (result.status === "failed" &&
          (!result.code || result.responseSha256)) ||
        records.some(
          (record) => record.status === "completed" || !record.retryable,
        )
      )
        throw new EvidenceLedgerError("corrupt_attempt_sequence");
      records.push(result);
    }
    return records;
  };
  const readCompleted = async <T>(
    runId: string,
    phase: EvidenceActivityPhase,
  ): Promise<T | undefined> => {
    const binding = await loadBinding(runId, phase);
    const value = await readJson(
      path.join(directory(runId), `${phase}.completed.json`),
    );
    if (value === undefined) return undefined;
    if (!binding) throw new EvidenceLedgerError("corrupt_completion");
    const completed = parse(completedSchema, value);
    const bindingSha256 = sha(canonical(binding));
    const history = await attempts(runId, phase, bindingSha256);
    const last = history.at(-1);
    if (
      completed.bindingSha256 !== bindingSha256 ||
      completed.responseSha256 !== sha(canonical(completed.response)) ||
      !last ||
      last.status !== "completed" ||
      last.attempt !== completed.attempt ||
      last.responseSha256 !== completed.responseSha256
    )
      throw new EvidenceLedgerError("corrupt_completion");
    return structuredClone(completed.response) as T;
  };
  const ledger = {
    async reserve(
      input: EvidenceReservationInput,
    ): Promise<EvidenceActivityReservation> {
      const parsed = parse(reservationInputSchema, input);
      const folder = directory(parsed.runId);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await syncDirectory(root);
      const reservation: EvidenceActivityReservation = {
        ...parsed,
        version: 1,
        logicalAllowanceReserved: true,
        maximumModelAttempts: 6,
        maximumSearchAttempts: 3,
        maximumTigerAttempts: 3,
        maximumAttemptsPerPhase: 3,
        scope: "dedicated-temporal-fixture",
        reservedAt: timestamp(),
      };
      await atomicCreate(path.join(folder, "reservation.json"), reservation);
      const stored = await loadReservation(parsed.runId);
      same(
        parse(reservationInputSchema, {
          runId: stored.runId,
          workflowId: stored.workflowId,
          inputSha256: stored.inputSha256,
          sourceAuditSha256: stored.sourceAuditSha256,
          provenance: stored.provenance,
        }),
        parsed,
      );
      return stored;
    },
    async execute<T>(
      input: EvidenceActivityInput,
      operation: (attempt: number) => Promise<T>,
    ): Promise<T> {
      const parsed = parse(activityInputSchema, input);
      const reservation = await loadReservation(parsed.runId);
      same(
        {
          workflowId: parsed.workflowId,
          sourceAuditSha256: parsed.sourceAuditSha256,
          provenance: parsed.provenance,
        },
        {
          workflowId: reservation.workflowId,
          sourceAuditSha256: reservation.sourceAuditSha256,
          provenance: reservation.provenance,
        },
      );
      const folder = directory(parsed.runId);
      const binding = { ...parsed, version: 1 as const };
      await atomicCreate(
        path.join(folder, `${parsed.phase}.binding.json`),
        binding,
      );
      same(await loadBinding(parsed.runId, parsed.phase), binding);
      const cached = await readCompleted<T>(parsed.runId, parsed.phase);
      if (cached !== undefined) return cached;
      const bindingSha256 = sha(canonical(binding));
      const eligible = (history: z.infer<typeof attemptSchema>[]) => {
        if (history.length >= 3) throw new EvidenceLedgerError("attempt_limit");
        if (
          history.some(
            (record) => record.status === "completed" || !record.retryable,
          )
        )
          throw new EvidenceLedgerError("activity_terminal");
      };
      eligible(await attempts(parsed.runId, parsed.phase, bindingSha256));
      const lock = path.join(folder, `${parsed.phase}.lock`);
      let handle;
      try {
        handle = await open(lock, "wx", 0o600);
      } catch (error) {
        if (isExists(error))
          throw new EvidenceLedgerError("ambiguous_inflight");
        throw new EvidenceLedgerError("persistence_failed");
      }
      try {
        await handle.writeFile("reserved\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(folder);
      const history = await attempts(parsed.runId, parsed.phase, bindingSha256);
      eligible(history);
      const attempt = history.length + 1;
      const prefix = path.join(folder, `${parsed.phase}.attempt-${attempt}`);
      if (
        !(await atomicCreate(`${prefix}.started.json`, {
          version: 1,
          attempt,
          bindingSha256,
          startedAt: timestamp(),
        }))
      )
        throw new EvidenceLedgerError("ambiguous_inflight");
      let response: T;
      try {
        response = await operation(attempt);
      } catch (error) {
        const code =
          error instanceof EvidenceActivityAttemptError
            ? error.code
            : "operation_failed";
        const retryable =
          error instanceof EvidenceActivityAttemptError &&
          error.retryable &&
          attempt < 3;
        if (
          !(await atomicCreate(`${prefix}.json`, {
            version: 1,
            attempt,
            bindingSha256,
            status: "failed",
            completedAt: timestamp(),
            retryable,
            code,
          }))
        )
          throw new EvidenceLedgerError("ambiguous_inflight");
        await unlink(lock);
        await syncDirectory(folder);
        throw new EvidenceActivityAttemptError(code, { retryable });
      }
      const responseSha256 = sha(canonical(response));
      if (
        !(await atomicCreate(`${prefix}.json`, {
          version: 1,
          attempt,
          bindingSha256,
          status: "completed",
          completedAt: timestamp(),
          retryable: false,
          responseSha256,
        }))
      )
        throw new EvidenceLedgerError("ambiguous_inflight");
      if (
        !(await atomicCreate(
          path.join(folder, `${parsed.phase}.completed.json`),
          { version: 1, bindingSha256, attempt, responseSha256, response },
        ))
      )
        throw new EvidenceLedgerError("ambiguous_inflight");
      // Completion is durable before releasing the lock or returning. A crash
      // here may leave the lock, but verified cached completion can be reused.
      await unlink(lock);
      await syncDirectory(folder);
      return structuredClone(response);
    },
    readCompleted,
    async inspect(runId: string) {
      const allowance = await loadReservation(runId);
      const activities = [];
      const counters = { select: 0, tiger: 0, search: 0, summary: 0 };
      for (const phase of phases) {
        const binding = await loadBinding(runId, phase);
        if (!binding) continue;
        const records = await attempts(runId, phase, sha(canonical(binding)));
        const response = await readCompleted(runId, phase);
        counters[phase] = records.length;
        activities.push({
          ...binding,
          attempts: records,
          ...(response !== undefined ? { response } : {}),
        });
      }
      return {
        allowance,
        activities,
        counters,
        modelAttempts: counters.select + counters.summary,
        searchAttempts: counters.search,
        tigerAttempts: counters.tiger,
      };
    },
  };
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof EvidenceLedgerError ||
        error instanceof EvidenceActivityAttemptError
      )
        throw error;
      throw new EvidenceLedgerError("persistence_failed");
    }
  };
  return {
    reserve: (input: EvidenceReservationInput) =>
      guarded(() => ledger.reserve(input)),
    execute: <T>(
      input: EvidenceActivityInput,
      operation: (attempt: number) => Promise<T>,
    ) => guarded(() => ledger.execute(input, operation)),
    readCompleted: <T>(runId: string, phase: EvidenceActivityPhase) =>
      guarded(() => ledger.readCompleted<T>(runId, phase)),
    inspect: (runId: string) => guarded(() => ledger.inspect(runId)),
  };
}
