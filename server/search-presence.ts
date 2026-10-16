import { z } from "zod";
import { redact } from "../shared/redact.js";
import {
  ProviderError,
  providerJson,
  providerKey,
  providerRequest,
  type ProviderOptions,
} from "./providers/free-resource-policy.js";

export const SEARCH_PRESENCE_TARGETS = [
  "https://github.com/himanshu748",
  "https://github.com/himanshu748/langchain-rag-tutorial-2026",
  "https://flowproof-demo.onrender.com/",
] as const;
export const SearchPresenceCheckSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("search_presence"),
    targetUrl: z.enum(SEARCH_PRESENCE_TARGETS),
    expectedText: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .refine(
        (value) =>
          !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>]/.test(value) &&
          redact(value) === value,
        "Use public brand or title text without private data or markup.",
      ),
    matchField: z.enum(["title", "snippet"]).default("title"),
    authorized: z.boolean().default(false),
    approved: z.boolean().default(false),
  })
  .strict();
export type SearchPresenceCheck = z.infer<typeof SearchPresenceCheckSchema>;
export interface SearchPresenceCitation {
  title: string;
  snippet: string | null;
  link: string;
  position: number | null;
  matchesExpectedText: boolean;
}
export type SearchPresenceFailureCode =
  | "approval_required"
  | "authorization_required"
  | "already_reserved"
  | "reservation_unavailable"
  | "provider_disabled"
  | "free_confirmation_required"
  | "budget_exhausted"
  | "request_failed"
  | "provider_rejected"
  | "invalid_response";
export interface SearchPresenceObservation {
  kind: "search_presence_observation";
  checkId: string;
  provider: "SerpApi";
  engine: "google";
  targetUrl: SearchPresenceCheck["targetUrl"];
  expectedText: string;
  matchField: SearchPresenceCheck["matchField"];
  query: string;
  status: "matched" | "empty" | "no_match" | "unavailable";
  observedAt: string;
  organicResultCount: number | null;
  scopedResultCount: number | null;
  citations: SearchPresenceCitation[];
  failureCode?: SearchPresenceFailureCode;
  limitation: string;
}
export interface SearchPresenceOptions extends ProviderOptions {
  /** Trusted durable once-only gate for this exact approved check. Never refund it. */
  reserveCheck: (check: Readonly<SearchPresenceCheck>) => Promise<boolean>;
}
export class SearchPresenceError extends Error {
  readonly code = "invalid_check";
  constructor() {
    super("A valid fixed-scope search-presence check is required.");
    this.name = "SearchPresenceError";
  }
}
const responseSchema = z.object({
  search_metadata: z.object({ status: z.literal("Success") }),
  search_information: z
    .object({
      organic_results_state: z.string().max(100).optional(),
      total_results: z.number().int().nonnegative().optional(),
    })
    .optional(),
  organic_results: z
    .array(
      z.object({
        title: z.string().max(2000),
        snippet: z.string().max(6000).optional(),
        link: z.string().max(2048),
        position: z.number().int().positive().optional(),
      }),
    )
    .max(100)
    .optional(),
});
const limitation =
  "A bounded Google organic search snapshot, separate from browser acceptance. Empty or unmatched results do not prove that a page is unindexed. No result link was visited.";
const normalizedText = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
function matchesText(value: string, expected: string) {
  const needle = normalizedText(expected).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])${needle}($|[^\\p{L}\\p{N}_])`,
    "u",
  ).test(normalizedText(value));
}
function scopedLink(raw: string, target: URL): string | null {
  try {
    if (!/^https:\/\//i.test(raw) || /[\s\\\u0000-\u001f\u007f]/.test(raw))
      return null;
    const value = new URL(raw);
    if (value.origin !== target.origin || value.username || value.password)
      return null;
    // Do not interpret encoded separators or path traversal as an owned prefix.
    if (/%(?:2f|5c|2e|00)/i.test(value.pathname)) return null;
    const prefix = target.pathname.replace(/\/$/, "").toLowerCase();
    const pathname = value.pathname.replace(/\/$/, "").toLowerCase();
    if (pathname !== prefix) return null;
    value.search = "";
    value.hash = "";
    return value.href;
  } catch {
    return null;
  }
}
function safeCode(error: unknown): SearchPresenceFailureCode {
  if (!(error instanceof ProviderError)) return "invalid_response";
  if (error.code === "disabled" || error.code === "not_configured")
    return "provider_disabled";
  if (
    ["free_confirmation_required", "allowance_unavailable"].includes(error.code)
  )
    return "free_confirmation_required";
  if (
    [
      "budget_exhausted",
      "request_failed",
      "provider_rejected",
      "invalid_response",
    ].includes(error.code)
  )
    return error.code as SearchPresenceFailureCode;
  return "invalid_response";
}

/** Executes at most one physical request. The caller supplies its separate allowance and durable check reservation. */
export async function executeSearchPresence(
  value: unknown,
  options: SearchPresenceOptions,
): Promise<SearchPresenceObservation> {
  const parsed = SearchPresenceCheckSchema.safeParse(value);
  if (!parsed.success) throw new SearchPresenceError();
  const check = Object.freeze(parsed.data);
  const target = new URL(check.targetUrl);
  const query = `site:${target.hostname}${target.pathname === "/" ? "" : target.pathname}`;
  const observation: SearchPresenceObservation = {
    kind: "search_presence_observation",
    checkId: check.id,
    provider: "SerpApi",
    engine: "google",
    targetUrl: check.targetUrl,
    expectedText: check.expectedText,
    matchField: check.matchField,
    query,
    status: "unavailable",
    observedAt: new Date((options.now ?? Date.now)()).toISOString(),
    organicResultCount: null,
    scopedResultCount: null,
    citations: [],
    limitation,
  };
  const unavailable = (failureCode: SearchPresenceFailureCode) => ({
    ...observation,
    failureCode,
  });
  if (!check.approved) return unavailable("approval_required");
  if (!check.authorized) return unavailable("authorization_required");
  try {
    if (!(await options.reserveCheck(check)))
      return unavailable("already_reserved");
  } catch {
    return unavailable("reservation_unavailable");
  }
  try {
    const key = providerKey("serpapi", options);
    const endpoint = new URL("https://serpapi.com/search.json");
    endpoint.search = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: key,
      hl: "en",
      safe: "active",
      num: "10",
    }).toString();
    const response = await providerRequest(
      "serpapi",
      endpoint,
      { method: "GET" },
      "search-visibility",
      1,
      "requests",
      options,
    );
    const result = responseSchema.safeParse(await providerJson(response));
    if (!result.success) return unavailable("invalid_response");
    if (
      result.data.organic_results === undefined &&
      result.data.search_information?.organic_results_state !== "Fully empty" &&
      result.data.search_information?.total_results !== 0
    )
      return unavailable("invalid_response");
    const organic = result.data.organic_results ?? [];
    const display = (text: string, maximum: number) =>
      redact(text.split(key).join("[redacted credential]"))
        .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>]/g, " ")
        .slice(0, maximum);
    const citations = organic
      .flatMap((item): SearchPresenceCitation[] => {
        const link = scopedLink(item.link, target);
        if (!link || link.includes(key) || redact(link) !== link) return [];
        const title = display(item.title, 240);
        const snippet =
          item.snippet === undefined ? null : display(item.snippet, 600);
        const field = check.matchField === "title" ? title : (snippet ?? "");
        const originalField =
          check.matchField === "title" ? item.title : (item.snippet ?? "");
        return [
          {
            title,
            snippet,
            link,
            position: item.position ?? null,
            matchesExpectedText:
              matchesText(originalField, check.expectedText) &&
              matchesText(field, check.expectedText),
          },
        ];
      })
      .slice(0, 10);
    return {
      ...observation,
      status: citations.some((item) => item.matchesExpectedText)
        ? "matched"
        : organic.length === 0
          ? "empty"
          : "no_match",
      observedAt: new Date((options.now ?? Date.now)()).toISOString(),
      organicResultCount: organic.length,
      scopedResultCount: citations.length,
      citations,
    };
  } catch (error) {
    return unavailable(safeCode(error));
  }
}
