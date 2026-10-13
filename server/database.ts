import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { PoolConfig } from "pg";

type Environment = Record<string, string | undefined>;

/** A custom CA must be obtained through an authenticated provider channel.
 * Its fingerprint is an operator attestation, not an automatic trust decision.
 */
export function databaseConfig(
  connectionString: string,
  env: Environment = process.env,
): PoolConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
    throw new Error("DATABASE_URL must identify a PostgreSQL host.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const plaintext = env.DATABASE_SSL === "false";
  if (plaintext && !loopback)
    throw new Error(
      "DATABASE_SSL=false is allowed only for loopback PostgreSQL.",
    );
  if (!plaintext && env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("Database certificate verification cannot be disabled.");

  // pg's URL parser can override the ssl object. Supply the verified settings
  // separately so URL flags and PGSSL environment settings cannot weaken them.
  for (const key of [...url.searchParams.keys()])
    if (/^ssl/i.test(key) || key.toLowerCase() === "uselibpqcompat")
      url.searchParams.delete(key);
  const file = env.DATABASE_CA_CERT_FILE || env.PGSSLROOTCERT;
  const inline = env.DATABASE_CA_CERT;
  const pin = env.DATABASE_CA_CERT_SHA256;
  if (file && inline)
    throw new Error("Configure one database CA source: file or inline PEM.");
  if (plaintext && (file || inline || pin))
    throw new Error(
      "A database CA cannot be configured for a plaintext connection.",
    );
  let ca: string | undefined;
  if (file || inline) {
    try {
      ca = inline || readFileSync(file!, "utf8");
    } catch {
      throw new Error("The configured database CA file cannot be read.");
    }
    if (!pin || !/^[a-f0-9]{64}$/i.test(pin.replaceAll(":", "")))
      throw new Error(
        "A provider-confirmed DATABASE_CA_CERT_SHA256 is required.",
      );
    if (
      (ca.match(/-----BEGIN CERTIFICATE-----/g) || []).length !== 1 ||
      ca.includes("PRIVATE KEY")
    )
      throw new Error(
        "Supply one public database CA certificate, without private keys.",
      );
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(ca);
    } catch {
      throw new Error("The configured database CA certificate is invalid.");
    }
    if (!certificate.ca)
      throw new Error("The database trust anchor must be a CA certificate.");
    if (
      certificate.fingerprint256.replaceAll(":", "").toLowerCase() !==
      pin.replaceAll(":", "").toLowerCase()
    )
      throw new Error(
        "The database CA fingerprint does not match the confirmed value.",
      );
    if (
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now()
    )
      throw new Error("The configured database CA is not currently valid.");
  } else if (pin) {
    throw new Error(
      "DATABASE_CA_CERT_SHA256 requires a database CA certificate.",
    );
  }
  return {
    connectionString: url.toString(),
    ssl: plaintext
      ? false
      : {
          rejectUnauthorized: true,
          servername: hostname,
          ...(ca ? { ca } : {}),
        },
    max: 3,
    connectionTimeoutMillis: 8000,
  };
}
