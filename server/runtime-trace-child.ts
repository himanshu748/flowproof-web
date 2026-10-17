import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RuntimeTraceWorkerInputSchema,
  RuntimeTraceWorkerOutputSchema,
} from "./runtime-trace.js";
import { hostedSentryAvailable } from "./sentry-configuration.js";

async function main() {
  let inputBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    inputBytes += bytes.length;
    if (inputBytes > 24 * 1024)
      throw new Error("Runtime trace input too large.");
    chunks.push(bytes);
  }
  const input = RuntimeTraceWorkerInputSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  const local = input.mode === "local_capture";
  if (!local && !hostedSentryAvailable())
    throw new Error("Runtime trace funding unavailable.");
  // Loading the SDK happens only in this short-lived child, after the measured
  // browser/provider work and the parent's irrevocable reservation are complete.
  const telemetry = await import("./observability.js");
  const envelopes: unknown[] = [];
  const captureEnvelope = local
    ? (value: unknown) => {
        if (envelopes.length < 2) envelopes.push(value);
      }
    : undefined;
  try {
    const status = telemetry.initObservability({
      captureEnvelope,
      maxEnvelopes: 2,
    });
    if (status.mode !== input.mode)
      throw new Error("Runtime trace mode mismatch.");
    const result = await telemetry.exportObservedRuntimeTrace(
      input.measurement,
    );
    const output = RuntimeTraceWorkerOutputSchema.parse({
      ok: true,
      receipt: {
        provider: "Sentry",
        mode: status.mode,
        ...result,
        ingestionVerified: false,
        measurementSha256: input.measurementSha256,
        maxEnvelopes: 2,
        maxRssMiB:
          Math.ceil((process.resourceUsage().maxRSS / 1024) * 100) / 100,
      },
      ...(local ? { envelopes } : {}),
    });
    const bytes = JSON.stringify(output);
    if (Buffer.byteLength(bytes) > 96 * 1024)
      throw new Error("Runtime trace output too large.");
    await telemetry.closeObservability();
    process.stdout.write(bytes, () => process.exit(0));
  } catch {
    await telemetry.closeObservability().catch(() => {});
    throw new Error("Runtime trace export failed.");
  }
}
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain)
  main().catch(() => {
    // Never echo errors, environment, measurements or provider details to stderr.
    process.stdout.write(
      JSON.stringify({ ok: false, error: "Runtime trace export failed." }),
      () => process.exit(1),
    );
  });
