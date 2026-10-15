/** SDK-free configuration inspection for the public parent process. */
export function hostedSentryAvailable(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const confirmed = Date.parse(env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT ?? "");
  if (
    env.FLOWPROOF_SENTRY_ENABLED !== "true" ||
    env.FLOWPROOF_SENTRY_FREE_CONFIRMED !== "true" ||
    !Number.isFinite(confirmed) ||
    now < confirmed ||
    now - confirmed > 86_400_000
  )
    return false;
  try {
    const dsn = new URL(env.SENTRY_DSN ?? "");
    return (
      dsn.protocol === "https:" &&
      /(?:^|\.)ingest(?:\.[a-z]+)?\.sentry\.io$/.test(dsn.hostname) &&
      Boolean(dsn.username) &&
      !dsn.password &&
      !dsn.search &&
      !dsn.hash
    );
  } catch {
    return false;
  }
}
