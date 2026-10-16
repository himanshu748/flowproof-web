import type { IntegrationStatus } from "../shared/types.js";
import type { ObservabilityStatus } from "./observability.js";
import { hostBackboardEnabled } from "./hosted-backboard.js";
import { googleGemmaConfiguration } from "./providers/gemma-google.js";
import { hostedSentryAvailable } from "./sentry-configuration.js";
import { hostOptionalEnabled } from "./hosted-optional.js";

/** Configuration is distinct from a verified provider request. Never expose keys. */
export function optionalIntegrations(
  publicDemo: boolean,
  observability?: ObservabilityStatus,
): IntegrationStatus[] {
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
      status: publicDemo ? "available" : "active",
      detail: publicDemo
        ? googleGemmaConfiguration().enabled
          ? "The opt-in live Gemma action runs a real Mastra generation and validation workflow in an isolated process. Its run ID is saved with the proposal. Browser audits run after that process exits; availability is separate from a successful invocation."
          : "Real SDK workflows were verified locally. Live hosted model orchestration is disabled until its confirmed-free Gemma configuration is available."
        : "Real SDK workflows coordinate approved browser execution and evidence-grounded summaries. Model configuration and durable workflow storage are separate.",
    },
    {
      name: "Sentry",
      status:
        (publicDemo && hostedSentryAvailable()) ||
        (!publicDemo && observability && observability.mode !== "disabled")
          ? "available"
          : "not_configured",
      detail:
        "Optional SDK tracing runs inside the isolated Gemma workflow with an allowlisted transport that excludes client text and secrets. A trace ID and SDK flush are separate from dashboard ingestion; configuration requires fresh confirmed-free account evidence.",
    },
    {
      name: "Temporal",
      status: enabled("FLOWPROOF_TEMPORAL_ENABLED")
        ? "available"
        : "not_configured",
      detail:
        "A local SDK worker and durable workflow support approved audits, bounded retries and recovery. A persistent local server is required; no hosted worker is claimed by this demo.",
    },
    {
      name: "Backboard",
      status: publicDemo
        ? hostBackboardEnabled()
          ? "available"
          : "not_configured"
        : enabled("BRIEFSTAMP_BACKBOARD_ENABLED")
          ? "available"
          : "not_configured",
      detail: publicDemo
        ? "Hosted project memory requires the operator token, a session-owned audit and fresh approved existing credits. Public visitors cannot call it. Configuration does not establish remote verification; free-host allowance files are ephemeral."
        : "Project memory writes anonymous assertion facts and retrieves only scoped structured records. Calls require a fresh verified allowance and explicit operator action; configuration is separate from remote verification.",
    },
    publicDemo
      ? {
          name: "SerpApi",
          status: hostOptionalEnabled("serpapi")
            ? "available"
            : "not_configured",
          detail:
            "Hosted search requires the operator token, a session-owned fixed Briefstamp homepage and fresh confirmed-free proof. At most one request per approved allowance. A search snapshot is an observation, never an audit pass; configuration is separate from remote verification. Free-host allowance files are ephemeral.",
        }
      : provider(
          "SerpApi",
          "BRIEFSTAMP_SERPAPI_ENABLED",
          "Operator search is restricted to authorized domains and never changes audit outcomes.",
        ),
    publicDemo
      ? {
          name: "ElevenLabs",
          status: hostOptionalEnabled("elevenlabs")
            ? "available"
            : "not_configured",
          detail:
            "Operator-only hosted speech reads counts from a session-owned completed synthetic sample, using a confirmed stock voice and fresh confirmed-free proof. At most one call of 1,000 characters; noncommercial scope and attribution are mandatory. Configuration is separate from a verified MP3. Free-host allowance files are ephemeral.",
        }
      : provider(
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
