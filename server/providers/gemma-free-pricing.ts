import { GOOGLE_GEMMA_MODEL } from "./gemma-google.js";

const PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=en";
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Fail closed if Google's published free-only pricing stops matching this model. */
export function confirmsFreeGemmaPricing(html: string): boolean {
  const section = html.match(
    /<h2\b[^>]*\bid=["']gemma-4["'][^>]*>[\s\S]*?(?=<h2\b|$)/i,
  )?.[0];
  const table = section?.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) return false;
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      text(cell[1]),
    ),
  );
  if (rows[0]?.[1] !== "Free Tier" || !rows[0]?.[2]?.startsWith("Paid Tier"))
    return false;
  return ["Input price", "Output price"].every((label) => {
    const matches = rows.filter((row) => row[0] === label);
    return (
      matches.length === 1 &&
      matches[0].length === 3 &&
      matches[0][1] === "Free of charge" &&
      matches[0][2] === "Not available"
    );
  });
}

export function createGemmaPricingVerifier(
  options: { fetcher?: typeof fetch; now?: () => number } = {},
) {
  let verifiedAt = 0;
  return async () => {
    const now = options.now?.() ?? Date.now();
    if (verifiedAt > 0 && now >= verifiedAt && now - verifiedAt < 60 * 60_000)
      return {
        model: GOOGLE_GEMMA_MODEL,
        checkedAt: new Date(verifiedAt).toISOString(),
        pricingUrl: PRICING_URL,
      };
    const response = await (options.fetcher ?? fetch)(PRICING_URL, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 512 * 1024
    )
      throw new Error(
        "Free Gemma pricing could not be confirmed. No model request was sent.",
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Free Gemma pricing is unavailable.");
    let bytes = 0;
    let html = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) {
        await reader.cancel();
        throw new Error("Free Gemma pricing response exceeded its limit.");
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    if (!confirmsFreeGemmaPricing(html))
      throw new Error(
        "Google's free-only Gemma pricing could not be confirmed. No model request was sent.",
      );
    verifiedAt = options.now?.() ?? Date.now();
    return {
      model: GOOGLE_GEMMA_MODEL,
      checkedAt: new Date(verifiedAt).toISOString(),
      pricingUrl: PRICING_URL,
    };
  };
}

export const verifyGemmaFreePricing = createGemmaPricingVerifier();
