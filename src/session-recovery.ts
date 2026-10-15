export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Old-session requests stop here. Their writes are never replayed. */
export class SessionChangedError extends Error {
  constructor(readonly recoveryFailed = false) {
    super("The demo session changed. The original request was not repeated.");
    this.name = "SessionChangedError";
  }
}

export function createSessionRecovery(recover: () => Promise<void>) {
  let revision = 0;
  let pendingRecovery: Promise<void> | null = null;

  return {
    invalidate() {
      revision++;
    },
    async run<T>(
      operation: () => Promise<T>,
      options: { bootstrap?: boolean } = {},
    ): Promise<T> {
      if (pendingRecovery && !options.bootstrap)
        throw new SessionChangedError();
      const requestRevision = revision;
      try {
        const value = await operation();
        if (requestRevision !== revision) throw new SessionChangedError();
        return value;
      } catch (error) {
        if (requestRevision !== revision) throw new SessionChangedError();
        if (
          !options.bootstrap &&
          error instanceof ApiRequestError &&
          error.status === 401 &&
          error.code === "SESSION_EXPIRED"
        ) {
          // Invalidate old responses before starting the one bootstrap request.
          revision++;
          const recovery = Promise.resolve().then(recover);
          pendingRecovery = recovery;
          let failed = false;
          try {
            await recovery;
          } catch {
            failed = true;
          } finally {
            if (pendingRecovery === recovery) pendingRecovery = null;
          }
          throw new SessionChangedError(failed);
        }
        throw error;
      }
    },
  };
}

/** A finished request may release only the busy state that it acquired. */
export function createOperationGate() {
  let owner = 0;
  let active = false;
  return {
    start(): number | null {
      if (active) return null;
      active = true;
      return ++owner;
    },
    isCurrent(id: number): boolean {
      return active && owner === id;
    },
    finish(id: number): boolean {
      if (!active || owner !== id) return false;
      active = false;
      return true;
    },
    invalidate() {
      owner++;
      active = false;
    },
  };
}
