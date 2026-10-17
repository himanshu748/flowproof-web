import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import {
  executeMastraEvidenceAgent,
  mastraChildEnvironment,
} from "../server/mastra-evidence-agent.js";
import { EVIDENCE_AGENT_TASK } from "../server/evidence-agent.js";
import type { Audit } from "../shared/types.js";
if (!process.argv.includes("--run-offline"))
  console.log(
    "Not run. --run-offline replays retained provider receipts through the actual isolated Mastra Agent; no external calls or allowances.",
  );
else {
  const output = path.resolve(
    "work/mastra-agent-runtime",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(output, { recursive: true });
  const root = "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/";
  const audit = JSON.parse(
    await readFile(root + "source-audit.json", "utf8"),
  ) as Audit;
  const fixture = JSON.parse(await readFile(root + "agent-run.json", "utf8"));
  const snapshot = structuredClone(audit);
  const claims: string[] = [];
  let models = 0;
  let tools = 0;
  globalThis.fetch = async () => {
    throw new Error("External network forbidden in retained-fixture proof");
  };
  assert.deepEqual(
    Object.keys(
      mastraChildEnvironment({
        GOOGLE_GEMMA_API_KEY: ["not", "a", "credential"].join("-"),
        SERPAPI_API_KEY: ["not", "a", "credential"].join("-"),
        NODE_OPTIONS: "--require unsafe",
        HTTPS_PROXY: "https://example.invalid",
      }),
    ).sort(),
    ["MASTRA_TELEMETRY_DISABLED", "NODE_ENV", "NO_COLOR"].sort(),
  );
  const receipt = await executeMastraEvidenceAgent(
    { audit, task: EVIDENCE_AGENT_TASK },
    {
      maxModelRequests: 2,
      searchTimeoutMs: 60_000,
      reserveExternal: async (op) => {
        assert(!claims.includes(op));
        claims.push(op);
      },
      generate: async (req) => {
        models++;
        const turn = fixture.modelTurns.find((x: any) => x.phase === req.phase);
        assert(turn?.result);
        return structuredClone(turn.result);
      },
      failureHistory: async () => {
        tools++;
        return structuredClone(
          fixture.toolReceipts.find((x: any) => x.tool === "failure_history")
            .result,
        );
      },
      searchVisibility: async () => {
        tools++;
        return structuredClone(
          fixture.toolReceipts.find((x: any) => x.tool === "search_visibility")
            .result,
        );
      },
    },
  );
  assert.equal(receipt.status, "completed");
  assert.equal(models, 2);
  assert.equal(tools, 2);
  assert.equal(receipt.orchestration?.provider, "Mastra Agent");
  assert.equal(receipt.orchestration?.modelCalls, 2);
  assert.equal(claims.length, 4);
  assert(isDeepStrictEqual(audit, snapshot));
  await writeFile(
    path.join(output, "receipt.json"),
    JSON.stringify(
      {
        scope:
          "Actual isolated Mastra Agent with retained model/tool replay; no new provider results",
        externalCalls: 0,
        publicJudgeSlots: 0,
        claims,
        receipt,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      status: receipt.status,
      modelFixtureReplays: models,
      toolFixtureReplays: tools,
      childKeysAbsent: true,
      output,
    }),
  );
}
