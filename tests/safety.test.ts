import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));
import {
  isPublicAddress,
  parseTarget,
  redact,
  resolvePublicTarget,
  safeFetch,
  validateTarget,
  LIMITS,
} from "../server/safety.js";
import { validateCheck, validateChecks } from "../server/schema.js";
import { sampleChecks } from "../server/sample.js";

function response(status: number, headers: Record<string, string>, body = "") {
  mocks.request.mockImplementationOnce(
    (_url: URL, _options: unknown, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error?: Error) => void;
      };
      req.destroy = (error) => {
        if (error) req.emit("error", error);
        req.emit("close");
      };
      req.end = () =>
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
            destroy: () => void;
          };
          res.statusCode = status;
          res.headers = headers;
          res.destroy = () => {};
          callback(res);
          res.emit("data", Buffer.from(body));
          res.emit("end");
          req.emit("close");
        });
      return req;
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("network safety boundary", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.2.3.4",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.2",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "2002:7f00:1::",
  ])("rejects non-public address %s", (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it.each([
    "http://example.com",
    "file:///etc/passwd",
    "https://name:secret@example.com",
    "https://example.com:8443",
    "https://localhost",
    "https://foo.local",
    "https://metadata.google.internal",
    "https://example.com/?token=private",
    "https://example.com/%2fadmin",
    "https://example.com\\@127.0.0.1",
  ])("rejects unsafe URL %s", (target) =>
    expect(() => parseTarget(target)).toThrow(),
  );
  it.each([
    "https://127.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://[::ffff:127.0.0.1]/",
  ])("rejects alternate loopback encoding %s", async (target) => {
    await expect(validateTarget(target)).rejects.toThrow();
  });
  it("rejects a hostname if any DNS answer is private", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      resolvePublicTarget("https://mixed.example.com"),
    ).rejects.toThrow(/private/);
  });
  it("pins the validated address while retaining hostname for TLS", async () => {
    response(
      200,
      { "content-type": "text/html", "set-cookie": "private" },
      "Public page",
    );
    const result = await safeFetch("https://example.com/");
    expect(result.body.toString()).toBe("Public page");
    expect(result.headers).not.toHaveProperty("set-cookie");
    const [url, options] = mocks.request.mock.calls[0];
    expect(url.hostname).toBe("example.com");
    const callback = vi.fn();
    options.lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.headers).not.toHaveProperty("cookie");
    expect(options.agent).toBe(false);
    expect(options.autoSelectFamily).toBe(false);
    expect(options.family).toBe(4);
  });
  it("revalidates every redirect and rejects private destinations before connection", async () => {
    response(302, { location: "https://169.254.169.254/latest/meta-data/" });
    await expect(safeFetch("https://example.com/")).rejects.toThrow(/private/);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("blocks redirects to another origin when policy is set", async () => {
    response(302, { location: "https://other.example.com/" });
    await expect(
      safeFetch("https://example.com/", {
        allowedOrigin: "https://example.com",
      }),
    ).rejects.toThrow(/Cross-origin/);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("blocks DNS rebinding on a redirected hostname", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.2", family: 4 }]);
    response(302, { location: "/next" });
    await expect(safeFetch("https://example.com/")).rejects.toThrow(/private/);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rejects mutations before resolving or sending a request", async () => {
    await expect(
      safeFetch("https://example.com/", { method: "POST" }),
    ).rejects.toThrow(/GET and HEAD/);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("enforces the shared request budget", async () => {
    await expect(
      safeFetch("https://example.com/", {
        budget: { requests: LIMITS.requests, bytes: 0 },
      }),
    ).rejects.toThrow(/request limit/);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("enforces response size before accepting large advertised bodies", async () => {
    response(200, { "content-length": String(LIMITS.responseBytes + 1) });
    await expect(safeFetch("https://example.com/")).rejects.toThrow(
      /size limit/,
    );
  });
  it("redacts common credentials and contact details from evidence", () => {
    const redacted = redact(
      "Email hello@example.com at +1 (555) 123-4567; token=private-token Bearer sk-testlongsecretvalue123",
    );
    expect(redacted).not.toContain("hello@example.com");
    expect(redacted).not.toContain("123-4567");
    expect(redacted).not.toContain("private-token");
    expect(redacted).not.toContain("sk-test");
  });
  it("redacts quoted secrets and generic bearer credentials completely", () => {
    const redacted = redact(
      '"token": "my secret value", Authorization: Bearer abcdef123456; password=super-secret',
    );
    expect(redacted).not.toContain("my secret");
    expect(redacted).not.toContain("abcdef");
    expect(redacted).not.toContain("super-secret");
  });
});

describe("typed approval schema", () => {
  it.each([
    "../../secret",
    "//other.example/",
    "/%2f%2fevil",
    "/foo?token=secret",
    "/%2e%2e/private",
    "/foo\\bar",
  ])("rejects unsafe page path %s", (pathname) => {
    expect(() =>
      validateCheck({ ...sampleChecks()[0], path: pathname }),
    ).toThrow();
  });
  it("rejects executable actions and unknown fields", () => {
    expect(() =>
      validateCheck({
        ...sampleChecks()[0],
        kind: "evaluate",
        code: 'fetch("secret")',
      }),
    ).toThrow();
    expect(() =>
      validateCheck({ ...sampleChecks()[0], script: "deleteAll()" }),
    ).toThrow();
  });
  it.each(["xpath=//script", "button >> text=Pay", ":has(*)", "div, script"])(
    "rejects selector DSL %s",
    (selector) =>
      expect(() => validateCheck({ ...sampleChecks()[0], selector })).toThrow(),
  );
  it("rejects duplicate check identities", () =>
    expect(() =>
      validateChecks([sampleChecks()[0], sampleChecks()[0]]),
    ).toThrow(/unique/));
  it("accepts a bounded proposed plan and preserves its unapproved state", () =>
    expect(
      validateChecks(sampleChecks()).every((check) => !check.approved),
    ).toBe(true));
});
