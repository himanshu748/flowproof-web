import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Audit, Project } from "../shared/types.js";
import {
  rememberAudit,
  recallProjectMemory,
} from "../server/providers/backboard.js";
import { checkSearchVisibility } from "../server/providers/serpapi.js";
import { createSpokenSampleReport } from "../server/providers/elevenlabs.js";
import { ProviderError } from "../server/providers/free-resource-policy.js";

const args = process.argv.slice(2);
if (
  args.length !== 2 ||
  args[0] !== "--run-provider" ||
  !["backboard", "serpapi", "elevenlabs"].includes(args[1])
) {
  console.log(
    JSON.stringify(
      {
        status: "not_run",
        providerCalls: 0,
        instructions:
          "Use --run-provider backboard|serpapi|elevenlabs only after independently confirming that account's free allowance, disabled overage, license scope and server configuration. This command does not configure or fund an account.",
      },
      null,
      2,
    ),
  );
} else {
  const provider = args[1];
  const directory = path.resolve(
    "work/optional-providers",
    new Date().toISOString().replace(/[:.]/g, "-"),
    provider,
  );
  await mkdir(directory, { recursive: true });
  const receipt: Record<string, unknown> = {
    provider,
    startedAt: new Date().toISOString(),
    scope:
      "Explicit synthetic provider smoke, not customer or hosted verification",
    status: "not_completed",
    actualAccountFreeProof:
      "Required by persistent allowance guard before every request; private proof is not copied here",
  };
  try {
    const audit = JSON.parse(
      await readFile(
        "docs/evidence/gemma-workflow/2026-10-15T05-55-49-919Z/broken-audit.json",
        "utf8",
      ),
    ) as Audit;
    if (audit.source?.target !== "sample")
      throw new ProviderError(
        "invalid_input",
        "Smoke evidence must identify the synthetic sample.",
      );
    if (provider === "backboard") {
      const accepted = await rememberAudit(audit);
      const retrieved = await recallProjectMemory(audit.projectId, "heading");
      const matching = retrieved.memories.filter(
        (memory) => memory.audit === accepted.auditScope,
      );
      Object.assign(receipt, {
        status: matching.length ? "verified" : "accepted_not_retrieved",
        accepted,
        matchingMemoryCount: matching.length,
        retrieved,
      });
      if (!matching.length) process.exitCode = 1;
    } else if (provider === "serpapi") {
      const project: Project = {
        id: "synthetic-search-smoke",
        name: "Briefstamp synthetic smoke",
        url: "https://flowproof-demo.onrender.com/",
        authorized: true,
        target: "website",
        sampleVariant: "healthy",
        brief: "Public demo search visibility only",
        checks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        generator: { provider: "synthetic smoke", model: null },
      };
      Object.assign(receipt, {
        status: "observed",
        observation: await checkSearchVisibility(project),
      });
    } else {
      const result = await createSpokenSampleReport(audit);
      await writeFile(path.join(directory, "sample-report.mp3"), result.audio, {
        flag: "wx",
      });
      Object.assign(receipt, {
        status: "audio_returned_not_listening_verified",
        mimeType: result.mimeType,
        bytes: result.audio.length,
        sha256: createHash("sha256").update(result.audio).digest("hex"),
        narration: result.narration,
        reservedCharacters: result.reservedCharacters,
        reportedCharacters: result.reportedCharacters,
        attribution: result.attribution,
        limitation: result.limitation,
      });
    }
  } catch (error) {
    Object.assign(receipt, {
      status: "failed_or_blocked",
      code: error instanceof ProviderError ? error.code : "local_failure",
      message:
        error instanceof ProviderError
          ? error.message
          : "The smoke could not finish; no raw error or credential was retained.",
    });
    process.exitCode = 1;
  }
  receipt.completedAt = new Date().toISOString();
  await writeFile(
    path.join(directory, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: receipt.status,
      provider,
      receiptPath: path.join(directory, "receipt.json"),
    }),
  );
}
