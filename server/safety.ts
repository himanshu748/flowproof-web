import { lookup } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}
export const LIMITS = {
  requests: 80,
  responseBytes: 3 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  requestMs: 8000,
  redirects: 3,
} as const;
export interface NetworkBudget {
  requests: number;
  bytes: number;
}
export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address.replace(/^\[|\]$/g, ""));
    // This rejects private, loopback, link-local, mapped-private, multicast,
    // documentation, carrier NAT, reserved and IPv6 transition ranges.
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export function parseTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafetyError("Enter a complete HTTPS website URL.");
  }
  if (input.length > 2048 || /[\x00-\x20\\]/.test(input))
    throw new SafetyError("Unsafe characters in website URL.");
  if (url.protocol !== "https:")
    throw new SafetyError("Only HTTPS websites can be audited.");
  if (url.username || url.password)
    throw new SafetyError("Credentials in website URLs are not allowed.");
  if (url.port && url.port !== "443")
    throw new SafetyError("Only the standard HTTPS port is allowed.");
  if (url.search)
    throw new SafetyError(
      "Query parameters are not allowed in audited URLs. Use a public, read-only page path.",
    );
  if (/%(?:25|2f|5c|00)/i.test(url.pathname))
    throw new SafetyError("Encoded URL separators are not allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (!hostname.includes(".") && !hostname.includes(":"))
  )
    throw new SafetyError("Local and internal hostnames are not allowed.");
  if (
    hostname === "metadata.google.internal" ||
    hostname === "instance-data.ec2.internal"
  )
    throw new SafetyError("Metadata endpoints are not allowed.");
  url.hash = "";
  return url;
}

export async function resolvePublicTarget(
  input: string,
): Promise<{ url: URL; addresses: { address: string; family: number }[] }> {
  const url = parseTarget(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = ipaddr.isValid(host)
      ? [
          {
            address: host,
            family: ipaddr.parse(host).kind() === "ipv6" ? 6 : 4,
          },
        ]
      : await Promise.race([
          lookup(host, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new SafetyError("DNS resolution timed out.")),
              4000,
            );
          }),
        ]);
  } catch {
    throw new SafetyError("The website hostname could not be resolved.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new SafetyError(
      "This hostname resolves to a private, local, metadata or reserved network.",
    );
  return { url, addresses };
}

export async function validateTarget(input: string): Promise<string> {
  return (await resolvePublicTarget(input)).url.href;
}

export { redact } from "../shared/redact";

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
}
export async function safeFetch(
  input: string,
  options: {
    method?: string;
    allowedOrigin?: string;
    budget?: NetworkBudget;
  } = {},
): Promise<SafeResponse> {
  const method = options.method ?? "GET";
  if (method !== "GET" && method !== "HEAD")
    throw new SafetyError("Only read-only GET and HEAD requests are allowed.");
  const budget = options.budget ?? { requests: 0, bytes: 0 };
  let current = input;
  for (let redirects = 0; redirects <= LIMITS.redirects; redirects++) {
    if (++budget.requests > LIMITS.requests)
      throw new SafetyError("The audit request limit was reached.");
    const { url, addresses } = await resolvePublicTarget(current);
    if (options.allowedOrigin && url.origin !== options.allowedOrigin)
      throw new SafetyError("Cross-origin requests and redirects are blocked.");
    const pinned = addresses[0];
    const response = await new Promise<SafeResponse>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          // All DNS answers were checked, and the connection uses this exact IP.
          // The URL hostname remains intact for Host and TLS certificate checks.
          lookup: (_host, _options, callback) =>
            callback(null, pinned.address, pinned.family),
          family: pinned.family,
          autoSelectFamily: false,
          agent: false,
          headers: {
            "user-agent":
              "Briefstamp/0.1 (authorized read-only acceptance audit)",
            accept: "*/*",
            "accept-encoding": "identity",
          },
        } as https.RequestOptions & { autoSelectFamily: boolean },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          const length = Number(res.headers["content-length"]);
          if (
            length > LIMITS.responseBytes ||
            length + budget.bytes > LIMITS.totalBytes
          ) {
            res.destroy();
            req.destroy(
              new SafetyError("The response exceeds the audit size limit."),
            );
            return;
          }
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            budget.bytes += chunk.length;
            if (
              bytes > LIMITS.responseBytes ||
              budget.bytes > LIMITS.totalBytes
            ) {
              req.destroy(
                new SafetyError("The response exceeds the audit size limit."),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const headers: Record<string, string> = {};
            for (const key of ["content-type", "location"]) {
              const value = res.headers[key];
              if (typeof value === "string") headers[key] = value;
            }
            resolve({
              status: res.statusCode ?? 502,
              headers,
              body: Buffer.concat(chunks),
              url: url.href,
            });
          });
        },
      );
      const timer = setTimeout(
        () => req.destroy(new SafetyError("The website request timed out.")),
        LIMITS.requestMs,
      );
      req.once("close", () => clearTimeout(timer));
      req.on("error", reject);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location)
        throw new SafetyError(
          "The website returned a redirect without a destination.",
        );
      if (redirects === LIMITS.redirects)
        throw new SafetyError("The website exceeded the redirect limit.");
      current = new URL(response.headers.location, url).href;
      continue;
    }
    return response;
  }
  throw new SafetyError("The website exceeded the redirect limit.");
}
