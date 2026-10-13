import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { databaseConfig } from "../server/database";

let root: string, ca: string, certificate: string, fingerprint: string;
let server: tls.Server, port: number;
const trust = () => ({
  DATABASE_CA_CERT: ca,
  DATABASE_CA_CERT_SHA256: fingerprint,
});
const connection = (host = "localhost") =>
  `postgresql://fixture@${host}:${port}/fixture`;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "flowproof-tls-"));
  writeFileSync(
    path.join(root, "ca.cnf"),
    "[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
  );
  writeFileSync(
    path.join(root, "server.ext"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n",
  );
  const openssl = (args: string[]) =>
    execFileSync("openssl", args, {
      cwd: root,
      stdio: "ignore",
      timeout: 15_000,
    });
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "1",
    "-subj",
    "/CN=FlowProof test CA",
    "-config",
    "ca.cnf",
  ]);
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
    "-config",
    "ca.cnf",
  ]);
  openssl([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.pem",
    "-days",
    "1",
    "-extfile",
    "server.ext",
  ]);
  ca = readFileSync(path.join(root, "ca.pem"), "utf8");
  certificate = readFileSync(path.join(root, "server.pem"), "utf8");
  fingerprint = new X509Certificate(ca).fingerprint256;
  server = tls.createServer(
    { key: readFileSync(path.join(root, "server.key")), cert: certificate },
    (socket) => socket.end("verified"),
  );
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
}, 30_000);
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (root) rmSync(root, { recursive: true, force: true });
});

function handshake(host: string, env: Record<string, string | undefined>) {
  const config = databaseConfig(connection(host), env);
  const ssl = config.ssl;
  if (!ssl || typeof ssl !== "object") throw new Error("TLS options required");
  return new Promise<boolean>((resolve, reject) => {
    const socket = tls.connect({ host: "127.0.0.1", port, ...ssl }, () => {
      resolve(socket.authorized);
      socket.end();
    });
    socket.once("error", reject);
    socket.setTimeout(2000, () =>
      socket.destroy(new Error("TLS fixture timed out")),
    );
  });
}

describe("verified PostgreSQL TLS", () => {
  it("completes a real TLS handshake with the confirmed CA and correct hostname", async () => {
    await expect(handshake("localhost", trust())).resolves.toBe(true);
    const config = databaseConfig(connection(), {
      DATABASE_CA_CERT_FILE: path.join(root, "ca.pem"),
      DATABASE_CA_CERT_SHA256: fingerprint.toLowerCase().replaceAll(":", ""),
    });
    expect((config.ssl as tls.ConnectionOptions).rejectUnauthorized).toBe(true);
  });
  it("rejects an otherwise trusted certificate for a different hostname", async () => {
    await expect(
      handshake("wrong.flowproof.test", trust()),
    ).rejects.toMatchObject({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });
  it("rejects a certificate whose CA has not been configured", async () => {
    await expect(handshake("localhost", {})).rejects.toMatchObject({
      code: expect.stringMatching(/CERT|SIGNATURE/),
    });
  });
  it("rejects missing, different and non-CA trust anchors before connecting", () => {
    expect(() =>
      databaseConfig(connection(), { DATABASE_CA_CERT: ca }),
    ).toThrow("provider-confirmed");
    expect(() =>
      databaseConfig(connection(), {
        ...trust(),
        DATABASE_CA_CERT_SHA256: "0".repeat(64),
      }),
    ).toThrow("fingerprint");
    expect(() =>
      databaseConfig(connection(), {
        DATABASE_CA_CERT: certificate,
        DATABASE_CA_CERT_SHA256: new X509Certificate(certificate)
          .fingerprint256,
      }),
    ).toThrow("CA certificate");
    expect(() =>
      databaseConfig(connection(), { ...trust(), DATABASE_CA_CERT: ca + ca }),
    ).toThrow("one public");
    expect(() =>
      databaseConfig(connection(), {
        ...trust(),
        DATABASE_CA_CERT_FILE: "missing",
      }),
    ).toThrow("one database CA source");
  });
  it("prevents URL and PGSSL flags from replacing verified pg TLS options", () => {
    const config = databaseConfig(
      connection() + "?ssl=no-verify&sslmode=disable&uselibpqcompat=true",
      {
        ...trust(),
        PGSSLMODE: "disable",
        PGSSLNEGOTIATION: "direct",
      },
    );
    expect(new URL(config.connectionString!).search).toBe("");
    const client = new pg.Client(config) as unknown as {
      connectionParameters: { ssl: tls.ConnectionOptions };
    };
    expect(client.connectionParameters.ssl.rejectUnauthorized).toBe(true);
    expect(client.connectionParameters.ssl.servername).toBe("localhost");
    expect(client.connectionParameters.ssl.checkServerIdentity).toBeUndefined();
  });
  it("allows explicit plaintext only for loopback and rejects global verification bypass", () => {
    expect(databaseConfig(connection(), { DATABASE_SSL: "false" }).ssl).toBe(
      false,
    );
    expect(() =>
      databaseConfig(connection("cloud.flowproof.test"), {
        DATABASE_SSL: "false",
      }),
    ).toThrow("loopback");
    expect(() =>
      databaseConfig(connection(), { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
    ).toThrow("cannot be disabled");
  });
});
