export function temporalConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.FLOWPROOF_TEMPORAL_ENABLED !== "true")
    throw new Error(
      "Temporal is disabled. Opt in with FLOWPROOF_TEMPORAL_ENABLED=true for the local operator service.",
    );
  if (env.FLOWPROOF_PUBLIC === "true" && env.FLOWPROOF_DEMO === "true")
    throw new Error(
      "Temporal workers are unavailable in the public sample demo.",
    );
  const address = env.FLOWPROOF_TEMPORAL_ADDRESS || "127.0.0.1:7233";
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(address);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)
    throw new Error(
      "This integration permits only an explicitly configured loopback Temporal server.",
    );
  return { address, namespace: "default" };
}
