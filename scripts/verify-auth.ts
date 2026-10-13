import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import http from "node:http";
const probe = net.createServer();
await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
const port = (probe.address() as net.AddressInfo).port;
await new Promise<void>((r) => probe.close(() => r()));
const token = randomBytes(32).toString("hex");
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    FLOWPROOF_PUBLIC: "true",
    FLOWPROOF_TOKEN: token,
    DATABASE_URL: "",
    FLOWPROOF_AI_ENABLED: "false",
    FLOWPROOF_GEMMA_ENABLED: "false",
    FLOWPROOF_DATA_DIR: "work/auth-smoke",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout?.resume();
child.stderr?.resume();
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + "/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "Isolated auth server did not start");
  assert.equal((await fetch(base + "/api/bootstrap")).status, 401);
  assert.equal((await fetch(base + "/evidence/fake/01.png")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/bootstrap", {
        headers: { "X-FlowProof-Token": "wrong-token" },
      })
    ).status,
    401,
  );
  const valid = await fetch(base + "/api/bootstrap", {
    headers: { "X-FlowProof-Token": token },
  });
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get("set-cookie") || "";
  assert(
    cookie.includes("HttpOnly") &&
      cookie.includes("Secure") &&
      cookie.includes("SameSite=Strict"),
  );
  assert.equal(
    (
      await fetch(base + "/api/bootstrap", {
        headers: { Cookie: cookie.split(";")[0] },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FlowProof-Token": token,
          Origin: "https://untrusted.invalid",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  const localStatus = await new Promise<number>((resolve, reject) => {
    const request = http.get(
      "http://127.0.0.1:4310/api/bootstrap",
      { headers: { Host: "rebinding.invalid" } },
      (response) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );
    request.on("error", reject);
  });
  assert.equal(localStatus, 403);
  await fs.writeFile(
    "outputs/auth-verification.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        unauthenticatedAPI: "denied",
        unauthenticatedEvidence: "denied",
        wrongToken: "denied",
        validToken: "accepted",
        sessionCookie: "HttpOnly Secure SameSite=Strict",
        crossOriginWrite: "denied",
        localHostRebinding: "denied",
      },
      null,
      2,
    ),
  );
  console.log(
    "Operator token, session cookie, evidence access, CSRF and local Host guards verified.",
  );
} finally {
  child.kill("SIGTERM");
}
