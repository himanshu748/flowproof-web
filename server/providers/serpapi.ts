import { z } from "zod";
import type { Project } from "../../shared/types.js";
import { parseTarget, redact } from "../safety.js";
import {
  ProviderError,
  providerJson,
  providerKey,
  providerRequest,
  type ProviderOptions,
} from "./free-resource-policy.js";

/** Observes search visibility only. It never follows result links or alters audit results. */
export async function checkSearchVisibility(
  project: Project,
  options: ProviderOptions = {},
) {
  const key = providerKey("serpapi", options);
  let target: URL;
  try {
    target = parseTarget(project.url);
  } catch {
    throw new ProviderError(
      "invalid_input",
      "A safe public HTTPS project is required.",
    );
  }
  const allowlist = (
    (options.env ?? process.env).BRIEFSTAMP_SEARCH_DOMAINS ?? ""
  )
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (
    !project.authorized ||
    project.target !== "website" ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      target.hostname,
    ) ||
    !allowlist.includes(target.hostname)
  )
    throw new ProviderError(
      "invalid_input",
      "Search requires an authorized website on the operator's exact domain allowlist.",
    );
  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.search = new URLSearchParams({
    engine: "google",
    q: `site:${target.hostname}`,
    api_key: key,
    hl: "en",
    safe: "active",
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
  const parsed = z
    .object({
      search_metadata: z.object({ status: z.literal("Success") }),
      organic_results: z
        .array(
          z.object({
            title: z.string().max(2000),
            link: z.string().max(2048),
            position: z.number().int().positive().optional(),
          }),
        )
        .max(100)
        .optional(),
    })
    .safeParse(await providerJson(response));
  if (!parsed.success)
    throw new ProviderError(
      "invalid_response",
      "SerpApi did not return a completed search response.",
    );
  const results = (parsed.data.organic_results ?? [])
    .flatMap((item) => {
      try {
        const url = parseTarget(item.link.split("?")[0].split("#")[0]);
        if (url.hostname !== target.hostname) return [];
        return [
          {
            title: redact(item.title).slice(0, 180),
            url: url.href,
            position: item.position ?? null,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 5);
  return {
    provider: "SerpApi",
    domain: target.hostname,
    query: `site:${target.hostname}`,
    observedAt: new Date((options.now ?? Date.now)()).toISOString(),
    results,
    status: "observed" as const,
    limitation:
      "A bounded search snapshot, not proof that every page is indexed or a ranking guarantee. No result URL was visited.",
  };
}
