import { describe, expect, it } from "vitest";
import {
  sanitizedFailure,
  schemaName,
  validateConfirmation,
  type FreeConfirmation,
} from "../scripts/verify-tiger";

const now = Date.parse("2026-10-13T12:00:00Z");
const serviceId = "fixture-service";
const hostname = "fixture.region.tsdb.cloud.timescale.com";
const connection = `postgresql://fixture:never-a-real-password@${hostname}:5432/test?sslmode=no-verify&options=-c%20search_path=public`;
const confirmation = (): FreeConfirmation => ({
  provider: "Tiger Data",
  serviceId,
  hostname,
  checkedAt: "2026-10-13T11:00:00Z",
  expiresAt: "2026-10-14T12:00:00Z",
  basis: "trial-no-card",
  outOfPocketLimit: 0,
  automaticPaidConversion: false,
  confirmedBy: "test fixture only",
  evidenceUrl: "https://console.cloud.timescale.com/services",
});

describe("Tiger verification gates", () => {
  it("requires an explicit matching service and a recent zero-cost confirmation", () => {
    expect(() =>
      validateConfirmation(confirmation(), undefined, serviceId, now),
    ).toThrow("local fallback");
    expect(() =>
      validateConfirmation(confirmation(), connection, undefined, now),
    ).toThrow("TIGER_SERVICE_ID");
    expect(() =>
      validateConfirmation(
        { ...confirmation(), serviceId: "other" },
        connection,
        serviceId,
        now,
      ),
    ).toThrow("exact service");
    expect(() =>
      validateConfirmation(
        { ...confirmation(), hostname: "other.tsdb.cloud.timescale.com" },
        connection,
        serviceId,
        now,
      ),
    ).toThrow("exact service");
    expect(() =>
      validateConfirmation(
        { ...confirmation(), outOfPocketLimit: 1 },
        connection,
        serviceId,
        now,
      ),
    ).toThrow("zero out-of-pocket");
    expect(() =>
      validateConfirmation(
        { ...confirmation(), automaticPaidConversion: true },
        connection,
        serviceId,
        now,
      ),
    ).toThrow("paid conversion");
    expect(() =>
      validateConfirmation(
        { ...confirmation(), checkedAt: "2026-10-10T00:00:00Z" },
        connection,
        serviceId,
        now,
      ),
    ).toThrow("past 24 hours");
    expect(() =>
      validateConfirmation(
        { ...confirmation(), expiresAt: "2026-10-13T12:01:00Z" },
        connection,
        serviceId,
        now,
      ),
    ).toThrow("ten minutes");
  });

  it("rejects local/impostor databases and unverified evidence sources", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "tsdb.cloud.timescale.com.attacker.example",
    ]) {
      expect(() =>
        validateConfirmation(
          { ...confirmation(), hostname: host },
          connection.replace(hostname, host),
          serviceId,
          now,
        ),
      ).toThrow("cloud service hostname");
    }
    for (const url of [
      "http://console.cloud.timescale.com",
      "https://attacker.example",
      "https://console.cloud.timescale.com/?token=private",
    ]) {
      expect(() =>
        validateConfirmation(
          { ...confirmation(), evidenceUrl: url },
          connection,
          serviceId,
          now,
        ),
      ).toThrow("HTTPS Tiger");
    }
  });

  it("strips URL options that could disable TLS or reuse a production schema", () => {
    const validated = validateConfirmation(
      { ...confirmation(), secretExtra: "not-for-receipts" },
      connection,
      serviceId,
      now,
    );
    expect(new URL(validated.connectionString).search).toBe("");
    expect(validated.confirmation).not.toHaveProperty("secretExtra");
    expect(validated.confirmation.serviceId).toBe(serviceId);
  });

  it("restricts schema names to a generated isolated namespace", () => {
    expect(schemaName("dddddddd-1111-2222-3333-444444444444")).toBe(
      "flowproof_verify_dddddddd111122223333444444444444",
    );
    expect(() => schemaName('public"; DROP TABLE x')).toThrow(
      "schema identifier",
    );
    expect(() => schemaName("public")).toThrow("schema identifier");
  });

  it("does not expose raw provider errors or embedded credentials", () => {
    const failure = sanitizedFailure(
      Object.assign(new Error(`Failed connection ${connection}`), {
        code: "28P01",
      }),
    );
    expect(failure.code).toBe("28P01");
    expect(JSON.stringify(failure)).not.toContain("never-a-real-password");
    expect(JSON.stringify(failure)).not.toContain(hostname);
  });
});
