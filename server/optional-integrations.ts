import type { IntegrationStatus } from "../shared/types.js";
import { observabilityStatus } from "./observability.js";

/** Configuration is distinct from a verified provider request. Never expose keys. */
export function optionalIntegrations(publicDemo: boolean): IntegrationStatus[] {
  const enabled = (key: string) => !publicDemo && process.env[key] === "true";
  const provider = (
    name: string,
    key: string,
    description: string,
  ): IntegrationStatus => ({
    name,
    status: enabled(key) ? "available" : "not_configured",
    detail: `${description} ${publicDemo ? "Disabled for public visitors." : "Provider calls require a fresh account-bound free allowance and explicit operator action; configured does not mean remotely verified."}`,
  });
  return [
    {
      name: "Mastra",
      status: "active",
      detail:
        "Real SDK workflows coordinate approved browser execution and evidence-grounded summaries. Model configuration and durable workflow storage are separate.",
    },
    {
      name: "Sentry",
      status:
        !publicDemo && observabilityStatus().mode !== "disabled"
          ? "available"
          : "not_configured",
      detail:
        "SDK tracing is implemented with an allowlisted transport that excludes client text and secrets. Hosted ingestion requires a confirmed free account; local envelope capture is separate evidence.",
    },
    {
      name: "Temporal",
      status: enabled("FLOWPROOF_TEMPORAL_ENABLED")
        ? "available"
        : "not_configured",
      detail:
        "A local SDK worker and durable workflow support approved audits, bounded retries and recovery. A persistent local server is required; no hosted worker is claimed by this demo.",
    },
    provider(
      "Backboard",
      "BRIEFSTAMP_BACKBOARD_ENABLED",
      "Project memory writes anonymous assertion facts and retrieves only scoped structured records.",
    ),
    provider(
      "SerpApi",
      "BRIEFSTAMP_SERPAPI_ENABLED",
      "A real one-request search against this demo was verified on the Free plan. Operator search is restricted to authorized domains and never changes audit outcomes.",
    ),
    provider(
      "ElevenLabs",
      "BRIEFSTAMP_ELEVENLABS_ENABLED",
      "Optional spoken reports cover noncommercial synthetic demonstrations only; free-plan commercial delivery is unsupported.",
    ),
    {
      name: "Entire",
      status: "available",
      detail:
        "The official local CLI imported one scoped development session and read back its 43 checkpoints. This retrospective local proof is not a public session or hosted search integration.",
    },
    {
      name: ".tech domain",
      status: "not_configured",
      detail:
        "A promotional domain requires a confirmed free offer and registration. The existing Render domain remains available.",
    },
  ];
}
