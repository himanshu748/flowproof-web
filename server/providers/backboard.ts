import { createHash } from "node:crypto";
import { z } from "zod";
import type { Audit, CheckKind } from "../../shared/types.js";
import {
  ProviderError,
  providerJson,
  providerKey,
  providerRequest,
  type ProviderOptions,
} from "./free-resource-policy.js";

const kinds = [
  "text_visible",
  "heading",
  "link",
  "image_alt",
  "no_horizontal_overflow",
  "manual",
] as const;
const factSchema = z
  .object({
    kind: z.enum(kinds),
    status: z.enum(["passed", "failed", "blocked", "unverified"]),
  })
  .strict();
const memorySchema = z
  .object({
    format: z.literal("briefstamp-audit-v1"),
    project: z.string().regex(/^[a-f0-9]{64}$/),
    audit: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: z.string().datetime({ offset: true }),
    facts: z.array(factSchema).min(1).max(24),
  })
  .strict();
const scopeHash = (value: string) =>
  createHash("sha256").update(`briefstamp:${value}`).digest("hex");
function assistantUrl(options: ProviderOptions, suffix = "") {
  const assistant = (options.env ?? process.env).BACKBOARD_ASSISTANT_ID;
  if (!assistant || !z.string().uuid().safeParse(assistant).success)
    throw new ProviderError(
      "not_configured",
      "A dedicated Backboard assistant UUID is required.",
    );
  return new URL(
    `https://app.backboard.io/api/assistants/${assistant}/memories${suffix}`,
  );
}

/** Stores only anonymous assertion kinds/statuses. Never sends names, URLs, briefs or DOM text. */
export async function rememberAudit(
  audit: Audit,
  options: ProviderOptions = {},
) {
  const key = providerKey("backboard", options);
  if (audit.status !== "completed" || !audit.completedAt)
    throw new ProviderError(
      "invalid_input",
      "Only a completed audit can become project memory.",
    );
  const parsed = memorySchema.safeParse({
    format: "briefstamp-audit-v1",
    project: scopeHash(audit.projectId),
    audit: scopeHash(audit.id),
    observedAt: audit.completedAt,
    facts: audit.results.map(({ kind, status }) => ({ kind, status })),
  });
  if (!parsed.success)
    throw new ProviderError(
      "invalid_input",
      "The audit facts are incomplete or outside the bounded schema.",
    );
  const response = await providerRequest(
    "backboard",
    assistantUrl(options),
    {
      method: "POST",
      headers: { "X-API-Key": key, "content-type": "application/json" },
      body: JSON.stringify({
        content: JSON.stringify(parsed.data),
        metadata: { source: "briefstamp", project_scope: parsed.data.project },
      }),
    },
    "memory-write",
    1,
    "requests",
    options,
  );
  // Add Memory documents HTTP201 but does not guarantee an immediately searchable record.
  await response.body?.cancel();
  return {
    status: "accepted" as const,
    provider: "Backboard",
    projectScope: parsed.data.project,
    auditScope: parsed.data.audit,
    persistedAndRetrieved: false as const,
  };
}

/** Retrieval is a separate observation; only our structured records in this project's scope are returned. */
export async function recallProjectMemory(
  projectId: string,
  kind: CheckKind,
  options: ProviderOptions = {},
) {
  const key = providerKey("backboard", options);
  if (!projectId || projectId.length > 100 || !kinds.includes(kind))
    throw new ProviderError(
      "invalid_input",
      "A project and supported assertion kind are required.",
    );
  const project = scopeHash(projectId);
  const response = await providerRequest(
    "backboard",
    assistantUrl(options, "/search"),
    {
      method: "POST",
      headers: { "X-API-Key": key, "content-type": "application/json" },
      body: JSON.stringify({
        query: `briefstamp-audit-v1 project ${project} ${kind} failed blocked unverified`,
        limit: 5,
      }),
    },
    "memory-search",
    1,
    "requests",
    options,
  );
  const envelope = z
    .object({
      memories: z
        .array(
          z.object({
            content: z.string().max(8_000),
            score: z.number().finite().optional(),
          }),
        )
        .max(50),
    })
    .safeParse(await providerJson(response));
  if (!envelope.success)
    throw new ProviderError(
      "invalid_response",
      "Backboard returned an unsupported memory response.",
    );
  const memories = envelope.data.memories
    .flatMap((item) => {
      try {
        const record = memorySchema.parse(JSON.parse(item.content));
        return record.project === project &&
          record.facts.some((fact) => fact.kind === kind)
          ? [{ ...record, score: item.score ?? null }]
          : [];
      } catch {
        return [];
      }
    })
    .slice(0, 5);
  return {
    provider: "Backboard",
    memories,
    scope:
      "Anonymous saved assertion outcomes; retrieved memory is not new audit evidence.",
  };
}
