import { describe, expect, it, vi } from "vitest";
import {
  confirmsFreeGemmaPricing,
  createGemmaPricingVerifier,
} from "../server/providers/gemma-free-pricing";

const table = `<table><thead><tr><th></th><th>Free Tier</th><th>Paid Tier, per 1M tokens</th></tr></thead><tbody><tr><td>Input price</td><td>Free of charge</td><td>Not available</td></tr><tr><td>Output price</td><td>Free of charge</td><td>Not available</td></tr></tbody></table>`;
const html = `<h2 id="another-model">Another model</h2>${table}<h2 class="model" id="gemma-4">Gemma 4</h2>${table}<h2 id="gemini">Gemini</h2>`;

describe("current official Gemma free-only pricing guard", () => {
  it("requires the exact Gemma 4 section and both free-only input/output rows", () => {
    expect(confirmsFreeGemmaPricing(html)).toBe(true);
    for (const invalid of [
      html.replace('id="gemma-4"', 'id="gemma-3"'),
      `<h2 id="gemma-4">Gemma 4</h2><p>Free of charge, Not available</p><h2>Next</h2>${table}`,
      `<h2 id="gemma-4">Gemma 4</h2>${table.replace("Free Tier", "Paid Tier")}`,
      `<h2 id="gemma-4">Gemma 4</h2>${table.replace("Output price", "Output cache price")}`,
      `<h2 id="gemma-4">Gemma 4</h2>${table.replace("Free of charge", "$0.01")}`,
      `<h2 id="gemma-4">Gemma 4</h2>${table.replace("Not available", "$0.10")}`,
      `<h2 id="gemma-4">Gemma 4</h2>${table.replace("</tbody>", "<tr><td>Input price</td><td>Free of charge</td><td>Not available</td></tr></tbody>")}`,
    ])
      expect(confirmsFreeGemmaPricing(invalid)).toBe(false);
  });

  it("uses the fixed URL without redirects and caches a verified table for less than one hour", async () => {
    let time = Date.parse("2026-10-15T10:00:00Z");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(html));
    const verify = createGemmaPricingVerifier({ fetcher, now: () => time });
    const initial = await verify();
    expect(initial).toEqual({
      model: "gemma-4-26b-a4b-it",
      checkedAt: "2026-10-15T10:00:00.000Z",
      pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
    });
    expect(fetcher.mock.calls[0][0]).toBe(initial.pricingUrl);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    time += 60 * 60_000 - 1;
    expect(await verify()).toEqual(initial);
    expect(fetcher).toHaveBeenCalledTimes(1);
    time++;
    expect((await verify()).checkedAt).toBe("2026-10-15T11:00:00.000Z");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not reuse stale evidence after network failure or a pricing change", async () => {
    let time = Date.parse("2026-10-15T10:00:00Z");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(html))
      .mockRejectedValueOnce(new Error("offline fixture"))
      .mockResolvedValueOnce(
        new Response(
          '<h2 id="gemma-4">Gemma 4</h2>' +
            table.replace("Free of charge", "$1"),
        ),
      )
      .mockResolvedValueOnce(new Response(html));
    const verify = createGemmaPricingVerifier({ fetcher, now: () => time });
    await verify();
    time += 60 * 60_000;
    await expect(verify()).rejects.toThrow();
    await expect(verify()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await verify()).checkedAt).toBe(new Date(time).toISOString());
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rechecks instead of trusting a cache from a future clock value", async () => {
    let time = Date.parse("2026-10-15T10:00:00Z");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(html));
    const verify = createGemmaPricingVerifier({ fetcher, now: () => time });
    await verify();
    time--;
    await verify();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["declared", "streamed"] as const)(
    "rejects %s response bodies over 512 KiB",
    async (mode) => {
      const response =
        mode === "declared"
          ? new Response(html, {
              headers: { "content-length": String(512 * 1024 + 1) },
            })
          : new Response(html + " ".repeat(512 * 1024));
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const verify = createGemmaPricingVerifier({ fetcher });
      await expect(verify()).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects HTTP failure and missing response bodies", async () => {
    for (const response of [
      new Response(html, { status: 503 }),
      new Response(null),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createGemmaPricingVerifier({ fetcher })()).rejects.toThrow();
    }
  });
});
