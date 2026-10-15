import { describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  createOperationGate,
  createSessionRecovery,
  SessionChangedError,
} from "../src/session-recovery";

const expired = () => new ApiRequestError("Expired", 401, "SESSION_EXPIRED");
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("public demo session recovery", () => {
  it("invalidates delayed old writes when an ordinary bootstrap finds a new session", async () => {
    const recover = vi.fn(async () => {});
    const client = createSessionRecovery(recover);
    const oldSave = deferred<{ approved: boolean }>();
    const oldResult = client.run(() => oldSave.promise).catch((error) => error);
    await client.run(
      async () => ({ projects: [{ id: "fresh", approved: false }] }),
      { bootstrap: true },
    );
    client.invalidate();
    oldSave.resolve({ approved: true });
    expect(await oldResult).toBeInstanceOf(SessionChangedError);
    expect(recover).not.toHaveBeenCalled();
    await expect(client.run(async () => "fresh operation")).resolves.toBe(
      "fresh operation",
    );
  });
  it("recovers an expired session without replaying an approval or model write", async () => {
    const recover = vi.fn(async () => {});
    const client = createSessionRecovery(recover);
    const write = vi.fn(async () => {
      throw expired();
    });
    await expect(client.run(write)).rejects.toBeInstanceOf(SessionChangedError);
    expect(write).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("coalesces simultaneous expiry responses into one bootstrap", async () => {
    const hold = deferred<void>();
    const recover = vi.fn(() => hold.promise);
    const client = createSessionRecovery(recover);
    const first = deferred<void>();
    const second = deferred<void>();
    const results = Promise.allSettled([
      client.run(() => first.promise),
      client.run(() => second.promise),
    ]);
    first.reject(expired());
    second.reject(expired());
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    hold.resolve();
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toBeInstanceOf(SessionChangedError);
    }
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("rejects late successful responses from the old session", async () => {
    const client = createSessionRecovery(async () => {});
    const oldPlan = deferred<{ approved: boolean }>();
    const oldRequest = client.run(() => oldPlan.promise);
    const observed = oldRequest.catch((error) => error);
    await expect(
      client.run(async () => {
        throw expired();
      }),
    ).rejects.toBeInstanceOf(SessionChangedError);
    oldPlan.resolve({ approved: true });
    expect(await observed).toBeInstanceOf(SessionChangedError);
  });

  it("also discards an older bootstrap response containing prior approvals", async () => {
    const client = createSessionRecovery(async () => {});
    const olderBootstrap = deferred<{ approved: boolean }>();
    const observed = client
      .run(() => olderBootstrap.promise, { bootstrap: true })
      .catch((error) => error);
    await expect(
      client.run(async () => {
        throw expired();
      }),
    ).rejects.toBeInstanceOf(SessionChangedError);
    olderBootstrap.resolve({ approved: true });
    expect(await observed).toBeInstanceOf(SessionChangedError);
  });

  it("does not start further ordinary requests while recovery is pending", async () => {
    const hold = deferred<void>();
    const recover = vi.fn(() => hold.promise);
    const client = createSessionRecovery(recover);
    const first = client
      .run(async () => {
        throw expired();
      })
      .catch((error) => error);
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    const write = vi.fn(async () => "should not run");
    await expect(client.run(write)).rejects.toBeInstanceOf(SessionChangedError);
    expect(write).not.toHaveBeenCalled();
    hold.resolve();
    expect(await first).toBeInstanceOf(SessionChangedError);
  });

  it("permits only the bootstrap operation through the recovery gate", async () => {
    let client: ReturnType<typeof createSessionRecovery>;
    const bootstrap = vi.fn(async () => "fresh unapproved session");
    client = createSessionRecovery(async () => {
      await expect(client.run(bootstrap, { bootstrap: true })).resolves.toBe(
        "fresh unapproved session",
      );
    });
    await expect(
      client.run(async () => {
        throw expired();
      }),
    ).rejects.toBeInstanceOf(SessionChangedError);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it.each([
    new ApiRequestError("Operator authentication required", 401),
    new ApiRequestError("Unauthorized", 401, "AUTH_REQUIRED"),
    new ApiRequestError("No access", 403, "SESSION_EXPIRED"),
    new Error("Connection failed"),
  ])("does not treat other failures as demo expiry (%s)", async (error) => {
    const recover = vi.fn(async () => {});
    const client = createSessionRecovery(recover);
    await expect(
      client.run(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });

  it("never recursively recovers a bootstrap failure", async () => {
    const recover = vi.fn(async () => {});
    const client = createSessionRecovery(recover);
    const error = expired();
    await expect(
      client.run(
        async () => {
          throw error;
        },
        { bootstrap: true },
      ),
    ).rejects.toBe(error);
    expect(recover).not.toHaveBeenCalled();
  });

  it("stops after one failed recovery and allows a later deliberate fresh request", async () => {
    const recover = vi.fn(async () => {
      throw new Error("Server unavailable");
    });
    const client = createSessionRecovery(recover);
    const error = await client
      .run(async () => {
        throw expired();
      })
      .catch((value) => value);
    expect(error).toBeInstanceOf(SessionChangedError);
    expect(error.recoveryFailed).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    await expect(client.run(async () => "new request")).resolves.toBe(
      "new request",
    );
  });

  it("can recover once again when a later fresh session itself expires", async () => {
    const recover = vi.fn(async () => {});
    const client = createSessionRecovery(recover);
    for (let index = 0; index < 2; index++) {
      await expect(
        client.run(async () => {
          throw expired();
        }),
      ).rejects.toBeInstanceOf(SessionChangedError);
    }
    expect(recover).toHaveBeenCalledTimes(2);
  });
});

describe("workspace operation ownership", () => {
  it("keeps the new operation busy when a late old operation finishes", () => {
    const gate = createOperationGate();
    const oldOperation = gate.start()!;
    gate.invalidate();
    const newOperation = gate.start()!;
    expect(gate.finish(oldOperation)).toBe(false);
    expect(gate.isCurrent(newOperation)).toBe(true);
    expect(gate.start()).toBeNull();
    expect(gate.finish(newOperation)).toBe(true);
    expect(gate.start()).not.toBeNull();
  });

  it("prevents two immediate clicks before React renders the busy state", () => {
    const gate = createOperationGate();
    const first = gate.start()!;
    expect(gate.start()).toBeNull();
    expect(gate.finish(first)).toBe(true);
    expect(gate.start()).not.toBeNull();
  });
});
