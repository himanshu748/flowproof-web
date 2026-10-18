import { z } from "zod";
import { createRequire } from "node:module";
import type { WorkflowRunState } from "@mastra/core/workflows";
import {
  createApprovalWorkflow,
  ApprovalWorkflowInputSchema,
  ApprovalResumeSchema,
  BrowserResumeSchema,
} from "./approval-workflow.js";

// One command per short-lived process; no credentials or browser. SDK snapshots
// move through the documented workflow storage API, never SDK private fields.
const CommandSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("start"), input: ApprovalWorkflowInputSchema })
    .strict(),
  z
    .object({
      type: z.literal("resume"),
      input: ApprovalResumeSchema,
      snapshot: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("complete"),
      input: BrowserResumeSchema,
      snapshot: z.record(z.unknown()),
    })
    .strict(),
]);
let pending:
  | { resolve: (value: unknown) => void; reject: () => void }
  | undefined;
let started = false;
process.on("message", async (message: unknown) => {
  const reply = z
    .object({
      type: z.literal("response"),
      id: z.literal(1),
      ok: z.boolean(),
      result: z.unknown().optional(),
    })
    .strict()
    .safeParse(message);
  if (reply.success) {
    if (!pending) return process.exit(1);
    const handler = pending;
    pending = undefined;
    if (reply.data.ok) handler.resolve(reply.data.result);
    else handler.reject();
    return;
  }
  if (started) return process.exit(1);
  started = true;
  try {
    const command = CommandSchema.parse(message);
    const runtime = await createApprovalWorkflow({
      externalBrowser: true,
      propose: async (input) =>
        new Promise((resolve, reject) => {
          pending = {
            resolve,
            reject: () => reject(new Error("Approval proposer failed.")),
          };
          process.send?.({
            type: "request",
            id: 1,
            operation: "propose",
            payload: input,
          });
        }),
      execute: async () => {
        throw new Error("Browser execution requires the external handoff.");
      },
    });
    if (command.type !== "start")
      await runtime.restoreSnapshot(
        command.snapshot as unknown as WorkflowRunState,
      );
    const run = await runtime.workflow.createRun(
      command.type === "start"
        ? undefined
        : { runId: String(command.snapshot.runId) },
    );
    const outcome =
      command.type === "start"
        ? await run.start({ inputData: command.input })
        : await run.resume({
            step:
              command.type === "resume"
                ? "await-developer-approval"
                : "browser-handoff",
            resumeData: command.input,
          });
    if (!["suspended", "success", "failed"].includes(outcome.status))
      throw new Error("Unexpected approval status.");
    const data: any = outcome;
    const result = {
      provider: "Mastra",
      package: "@mastra/core",
      version: createRequire(import.meta.url)("@mastra/core/package.json")
        .version,
      workflowId: "briefstamp-explicit-approval",
      runId: run.runId,
      status: data.status,
      scope: "process-local",
      durable: false,
      maxRssMiB: Math.ceil((process.resourceUsage().maxRSS / 1024) * 100) / 100,
      steps: Object.entries(data.steps ?? {})
        .filter(([id]) => id !== "input")
        .map(([id, step]: [string, any]) => ({ id, status: step.status })),
      ...(command.type === "start" && data.status === "suspended"
        ? { suspension: data.steps["await-developer-approval"].suspendPayload }
        : {}),
      ...(command.type === "resume" && data.status === "suspended"
        ? { dispatch: data.steps["browser-handoff"].suspendPayload }
        : {}),
      ...(data.status === "success" ? { result: data.result } : {}),
    };
    const snapshot =
      data.status === "suspended"
        ? await runtime.exportSnapshot(run.runId)
        : undefined;
    process.send?.(
      { type: "receipt", receipt: result, ...(snapshot ? { snapshot } : {}) },
      () => process.exit(0),
    );
  } catch {
    process.send?.({ type: "failed" }, () => process.exit(1));
  }
});
process.on("disconnect", () => process.exit(0));
