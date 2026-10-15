import { describe, expect, it, vi } from "vitest";
import {
  generateGoogleGemmaProposal,
  googleGemmaConfiguration,
  GOOGLE_GEMMA_MODEL,
  GOOGLE_GEMMA_MAX_ATTEMPTS,
  GOOGLE_GEMMA_RETRY_STATUSES,
  GemmaAttemptSchema,
  GoogleGemmaFailureSchema,
  GoogleGemmaError,
  serializeGoogleGemmaFailure,
} from "../server/providers/gemma-google";

const now = () => Date.parse("2026-10-15T10:00:00.000Z");
const enabled: NodeJS.ProcessEnv = {
  BRIEFSTAMP_PUBLIC_GEMMA_ENABLED: "true",
  BRIEFSTAMP_GEMMA_CONFIRMED_FREE: "true",
  GOOGLE_GEMMA_API_KEY: ["synthetic-google", "key-for-tests"].join("-"),
  BRIEFSTAMP_GEMMA_FREE_UNTIL: "2026-10-20T10:00:00.000Z",
};
const requirements = ['The homepage heading must say "Welcome".'];
const check = {
  requirementIndex: 0,
  kind: "heading",
  path: "/",
  expected: "Welcome",
  viewport: "desktop",
};
const completion = (checks: unknown[] = [check]) => ({
  id: "provider-response-id-must-not-be-exposed",
  candidates: [
    {
      finishReason: "STOP",
      content: { role: "model", parts: [{ text: JSON.stringify({ checks }) }] },
    },
  ],
  usageMetadata: {
    promptTokenCount: 140,
    candidatesTokenCount: 45,
    totalTokenCount: 185,
  },
});
const response = (value: unknown = completion()) => Response.json(value);

// Sanitized selected fields of the actual 2026-10-15T09:30:11.234Z response.
// No response ID, credentials, account metadata or client data are retained.
const observedNativeResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: "",
            thought: true,
          },
          {
            text: '```json\n{\n  "checks": [\n    {\n      "requirementIndex": 0,\n      "kind": "heading",\n      "path": "/",\n      "expected": "Design that moves business forward.",\n      "viewport": "desktop"\n    },\n    {\n      "requirementIndex": 1,\n      "kind": "link",\n      "path": "/",\n      "expected": "Start a project",\n      "viewport": "desktop"\n    },\n    {\n      "requirementIndex": 2,\n      "kind": "image_alt",\n      "path": "/",\n      "expected": "",\n      "viewport": "desktop"\n    },\n    {\n      "requirementIndex": 3,\n      "kind": "no_horizontal_overflow",\n      "path": "/",\n      "expected": "",\n      "viewport": "mobile"\n    },\n    {\n      "requirementIndex": 4,\n      "kind": "text_visible",\n      "path": "/",\n      "expected": "Independent by design.",\n      "viewport": "desktop"\n    },\n    {\n      "requirementIndex": 5,\n      "kind": "manual",\n      "path": "/",\n      "expected": "",\n      "viewport": "desktop"\n    }\n  ]\n}\n```',
          },
        ],
        role: "model",
      },
      finishReason: "STOP",
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 320,
    candidatesTokenCount: 297,
    totalTokenCount: 617,
    promptTokensDetails: [
      {
        modality: "TEXT",
        tokenCount: 320,
      },
    ],
    serviceTier: "standard",
  },
};

describe("fixed confirmed-free public Google Gemma adapter", () => {
  it("rejects the observed 390px viewport instead of silently repairing model output", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(completion([{ ...check, viewport: "390px" }])),
      );
    await expect(
      generateGoogleGemmaProposal(requirements, { env: enabled, fetcher, now }),
    ).rejects.toMatchObject({
      code: "invalid_plan",
      attempts: [
        {
          status: 200,
          usage: { promptTokens: 140, completionTokens: 45, totalTokens: 185 },
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.systemInstruction.parts[0].text).toContain(
      'For a 390px requirement use "viewport":"mobile"',
    );
  });
  it("makes one bounded fixed-model native request and returns only safe proposal/usage metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const output = await generateGoogleGemmaProposal(requirements, {
      env: {
        ...enabled,
        GOOGLE_GEMMA_MODEL: "paid-model",
        GOOGLE_GEMMA_URL: "https://attacker.invalid",
      },
      fetcher,
      now,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent",
    );
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(
      enabled.GOOGLE_GEMMA_API_KEY,
    );
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new URL(String(url)).search).toBe("");
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual([
      "contents",
      "generationConfig",
      "systemInstruction",
    ]);
    expect(body).toMatchObject({
      systemInstruction: {
        parts: [{ text: expect.stringContaining("Return only JSON") }],
      },
      generationConfig: {
        maxOutputTokens: 1800,
        temperature: 0,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    });
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe("user");
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({
      requirements: [{ requirementIndex: 0, requirement: requirements[0] }],
    });
    expect(output).toEqual({
      checks: [check],
      model: GOOGLE_GEMMA_MODEL,
      usage: { promptTokens: 140, completionTokens: 45, totalTokens: 185 },
      latencyMs: expect.any(Number),
      attempts: [
        {
          index: 1,
          status: 200,
          durationMs: expect.any(Number),
          requestBytes: Buffer.byteLength(String(init?.body), "utf8"),
          retryDelayMs: 0,
          usage: { promptTokens: 140, completionTokens: 45, totalTokens: 185 },
          providerStatus: null,
        },
      ],
      transportNormalization: {
        emptyThoughtPartIgnored: false,
        wholeJsonFenceRemoved: false,
      },
    });
    expect(output.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(output)).not.toContain("provider-response-id");
    expect(JSON.stringify(output)).not.toContain(enabled.GOOGLE_GEMMA_API_KEY);
  });

  it.each([
    { BRIEFSTAMP_PUBLIC_GEMMA_ENABLED: "false" },
    { BRIEFSTAMP_GEMMA_CONFIRMED_FREE: "false" },
    { GOOGLE_GEMMA_API_KEY: undefined },
    { GOOGLE_GEMMA_API_KEY: "unsafe\nkey" },
    { BRIEFSTAMP_GEMMA_FREE_UNTIL: "2026-10-15T10:00:00.000Z" },
    { BRIEFSTAMP_GEMMA_FREE_UNTIL: "2026-10-23T10:00:00.000Z" },
    { BRIEFSTAMP_GEMMA_FREE_UNTIL: "not-a-date" },
  ])(
    "blocks invalid configuration without any provider request: %j",
    async (override) => {
      const fetcher = vi.fn<typeof fetch>();
      const env = { ...enabled, ...override };
      expect(googleGemmaConfiguration(env, now).enabled).toBe(false);
      await expect(
        generateGoogleGemmaProposal(requirements, { env, fetcher, now }),
      ).rejects.toMatchObject({ code: "not_configured" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("pure configuration inspection permits at most seven days and exposes no credential", () => {
    const configuration = googleGemmaConfiguration(
      { ...enabled, BRIEFSTAMP_GEMMA_FREE_UNTIL: "2026-10-22T10:00:00.000Z" },
      now,
    );
    expect(configuration.enabled).toBe(true);
    expect(JSON.stringify(configuration)).not.toContain(
      enabled.GOOGLE_GEMMA_API_KEY,
    );
  });

  it.each(
    [
      [],
      Array.from({ length: 7 }, () => requirements[0]),
      ["x".repeat(2001)],
      ["x".repeat(2000), "y".repeat(2000), "z".repeat(2000), "extra"],
      ["Visit https://client.invalid then check the page."],
      ["Use token=private-example-token in the page."],
      ["Display the contact person@example.invalid on the page."],
    ].map((input) => ({ input })),
  )(
    "rejects oversize or non-minimized input before I/O: %j",
    async ({ input }) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        generateGoogleGemmaProposal(input, { env: enabled, fetcher, now }),
      ).rejects.toMatchObject({ name: "GoogleGemmaError" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...check, approved: true },
    { ...check, selector: "h1" },
    { ...check, script: "alert(1)" },
    { ...check, id: "model-id" },
    { ...check, kind: "click" },
    { ...check, path: "//attacker.invalid/" },
    { ...check, path: "/%2e%2e/secret" },
    { ...check, expected: "" },
    { ...check, viewport: "tablet" },
  ])("rejects unsafe or unknown generated check fields: %j", async (unsafe) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(completion([unsafe])));
    await expect(
      generateGoogleGemmaProposal(requirements, { env: enabled, fetcher, now }),
    ).rejects.toMatchObject({ code: "invalid_plan" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(
    [
      [check],
      [check, check],
      [{ ...check, requirementIndex: 1 }, check],
      [check, { ...check, requirementIndex: 2 }],
    ].map((checks) => ({ checks })),
  )(
    "requires exactly one result in order for every input index: %j",
    async ({ checks }) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(completion(checks)));
      await expect(
        generateGoogleGemmaProposal(
          [...requirements, 'The page must show "Contact".'],
          { env: enabled, fetcher, now },
        ),
      ).rejects.toMatchObject({ code: "invalid_plan" });
    },
  );

  it.each(["MAX_TOKENS", "MALFORMED_FUNCTION_CALL", "SAFETY"])(
    "rejects unfinished or non-text completion %s",
    async (finishReason) => {
      const data = completion();
      data.candidates[0].finishReason = finishReason;
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data));
      await expect(
        generateGoogleGemmaProposal(requirements, {
          env: enabled,
          fetcher,
          now,
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    },
  );

  it("rejects malformed content and extra plan fields without extracting JSON from surrounding text", async () => {
    for (const text of [
      "```json\n{}\n```",
      JSON.stringify({ checks: [check], script: "bad" }),
      `Here is the plan: ${JSON.stringify({ checks: [check] })}`,
    ]) {
      const data = completion();
      data.candidates[0].content.parts[0].text = text;
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data));
      await expect(
        generateGoogleGemmaProposal(requirements, {
          env: enabled,
          fetcher,
          now,
        }),
      ).rejects.toMatchObject({ code: "invalid_plan" });
    }
  });

  it("accepts the observed native empty thought and whole JSON fence without changing any proposal", async () => {
    const expectedChecks = [
      {
        requirementIndex: 0,
        kind: "heading",
        path: "/",
        expected: "Design that moves business forward.",
        viewport: "desktop",
      },
      {
        requirementIndex: 1,
        kind: "link",
        path: "/",
        expected: "Start a project",
        viewport: "desktop",
      },
      {
        requirementIndex: 2,
        kind: "image_alt",
        path: "/",
        expected: "",
        viewport: "desktop",
      },
      {
        requirementIndex: 3,
        kind: "no_horizontal_overflow",
        path: "/",
        expected: "",
        viewport: "mobile",
      },
      {
        requirementIndex: 4,
        kind: "text_visible",
        path: "/",
        expected: "Independent by design.",
        viewport: "desktop",
      },
      {
        requirementIndex: 5,
        kind: "manual",
        path: "/",
        expected: "",
        viewport: "desktop",
      },
    ];
    const output = await generateGoogleGemmaProposal(
      [
        'The homepage heading must say "Design that moves business forward.".',
        'The homepage must have a link labelled "Start a project".',
        "Every image must have nonempty alternative text.",
        "The homepage must have no horizontal overflow at 390px.",
        'The homepage must show "Independent by design.".',
        "The homepage should feel premium.",
      ],
      {
        env: enabled,
        now,
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(response(observedNativeResponse)),
      },
    );
    expect(output.checks).toEqual(expectedChecks);
    expect(output.transportNormalization).toEqual({
      emptyThoughtPartIgnored: true,
      wholeJsonFenceRemoved: true,
    });
    expect(output.usage).toEqual({
      promptTokens: 320,
      completionTokens: 297,
      totalTokens: 617,
    });
  });

  it.each([false, true])(
    "records only the wrappers actually removed (fence: %s)",
    async (fenced) => {
      const data = completion();
      const text = JSON.stringify({ checks: [check] });
      data.candidates[0].content.parts[0].text = fenced
        ? `\`\`\`json\r\n${text}\r\n\`\`\``
        : text;
      const output = await generateGoogleGemmaProposal(requirements, {
        env: enabled,
        now,
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(data)),
      });
      expect(output.checks).toEqual([check]);
      expect(output.transportNormalization).toEqual({
        emptyThoughtPartIgnored: false,
        wholeJsonFenceRemoved: fenced,
      });
    },
  );

  it("rejects prose, other fence languages, multiple fences, code and unsafe fenced plans", async () => {
    const plan = JSON.stringify({ checks: [check] });
    for (const text of [
      `Here is the plan:\n\`\`\`json\n${plan}\n\`\`\``,
      `\`\`\`json\n${plan}\n\`\`\`\nDone.`,
      `\`\`\`javascript\n${plan}\n\`\`\``,
      `\`\`\`\n${plan}\n\`\`\``,
      `\`\`\`json\n${plan}\n\`\`\`\n\`\`\`json\n${plan}\n\`\`\``,
      `\`\`\`json\nconsole.log(${plan})\n\`\`\``,
      `\`\`\`json\n${JSON.stringify({ checks: [{ ...check, approved: true }] })}\n\`\`\``,
      `\`\`\`json\n${JSON.stringify({ checks: [{ ...check, script: "execute()" }] })}\n\`\`\``,
      `\`\`\`json\n${JSON.stringify({ checks: [{ ...check, expected: "nested ``` fence" }] })}\n\`\`\``,
    ]) {
      const data = completion();
      data.candidates[0].content.parts[0].text = text;
      await expect(
        generateGoogleGemmaProposal(requirements, {
          env: enabled,
          now,
          fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(data)),
        }),
      ).rejects.toMatchObject({ code: "invalid_plan" });
    }
  });

  it("accepts only one final text part and rejects nonempty thoughts, actions and multiple candidates", async () => {
    const text = JSON.stringify({ checks: [check] });
    for (const parts of [
      [{ text, thought: true }],
      [{ text, functionCall: { name: "execute", args: {} } }],
      [{ functionCall: { name: "execute", args: {} } }],
      [{ inlineData: { mimeType: "image/png", data: "a" } }],
      [{ text }, { text }],
      [{ text: "reasoning", thought: true }, { text }],
      [{ text: " ", thought: true }, { text }],
      [{ text: "", thought: true }],
      [{ text: "", thought: true }, { text: "", thought: true }, { text }],
      [
        {
          text: "",
          thought: true,
          functionCall: { name: "execute", args: {} },
        },
        { text },
      ],
      [],
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        response({
          candidates: [
            { finishReason: "STOP", content: { role: "model", parts } },
          ],
        }),
      );
      await expect(
        generateGoogleGemmaProposal(requirements, {
          env: enabled,
          fetcher,
          now,
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
    const data = completion();
    data.candidates.push(data.candidates[0]);
    await expect(
      generateGoogleGemmaProposal(requirements, {
        env: enabled,
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(data)),
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    const accepted = completion();
    Object.assign(accepted.candidates[0].content.parts[0], { thought: false });
    const output = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        response({
          ...accepted,
          modelVersion: GOOGLE_GEMMA_MODEL,
          responseId: "private-metadata",
        }),
      ),
      now,
    });
    expect(output.checks).toEqual([check]);
    expect(JSON.stringify(output)).not.toContain("private-metadata");
    const emptyThought = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      now,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        response({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: [{ text: "", thought: true }, { text }],
              },
            },
          ],
        }),
      ),
    });
    expect(emptyThought.checks).toEqual([check]);
    expect(emptyThought.transportNormalization).toEqual({
      emptyThoughtPartIgnored: true,
      wholeJsonFenceRemoved: false,
    });
  });

  it("keeps missing usage null and rejects usage above the cap or inconsistent totals", async () => {
    const data = completion();
    const { usageMetadata: _usage, ...withoutUsage } = data;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(withoutUsage));
    expect(
      (
        await generateGoogleGemmaProposal(requirements, {
          env: enabled,
          fetcher,
          now,
        })
      ).usage,
    ).toBeNull();
    for (const usageMetadata of [
      {
        promptTokenCount: 140,
        candidatesTokenCount: 1801,
        totalTokenCount: 1941,
      },
      { promptTokenCount: 140, candidatesTokenCount: 45, totalTokenCount: 1 },
    ]) {
      await expect(
        generateGoogleGemmaProposal(requirements, {
          env: enabled,
          fetcher: vi
            .fn<typeof fetch>()
            .mockResolvedValue(response({ ...data, usageMetadata })),
          now,
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("bounds actual response bytes even without content-length", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(65_537)));
    await expect(
      generateGoogleGemmaProposal(requirements, { env: enabled, fetcher, now }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not retry, retain raw provider errors, or expose secrets from network exceptions", async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(`private failure ${enabled.GOOGLE_GEMMA_API_KEY}`, {
          status: 429,
        }),
      ),
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new Error(`private failure ${enabled.GOOGLE_GEMMA_API_KEY}`),
        ),
    ]) {
      const error = await generateGoogleGemmaProposal(requirements, {
        env: enabled,
        fetcher,
        now,
      }).catch((value) => value);
      expect(error).toMatchObject({ name: "GoogleGemmaError" });
      expect(String(error)).not.toContain("private failure");
      expect(String(error)).not.toContain(enabled.GOOGLE_GEMMA_API_KEY);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

describe("bounded Google Gemma transient retries and safe receipts", () => {
  const transient = (status: number, providerStatus: string = "INTERNAL") =>
    Response.json(
      {
        error: {
          code: status,
          status: providerStatus,
          message: `private ${enabled.GOOGLE_GEMMA_API_KEY}`,
          details: [{ secret: "client-private" }],
        },
        responseId: "private-response-id",
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 2,
          totalTokenCount: 102,
        },
      },
      { status },
    );

  it.each(GOOGLE_GEMMA_RETRY_STATUSES)(
    "retries explicit HTTP %i once with identical request and records actual success",
    async (status) => {
      let milliseconds = 0;
      const wait = vi.fn(async (delay: number) => {
        milliseconds += delay;
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(async () => {
          milliseconds += 30;
          return transient(status);
        })
        .mockImplementationOnce(async () => {
          milliseconds += 50;
          return response();
        });
      const result = await generateGoogleGemmaProposal(requirements, {
        env: enabled,
        now,
        fetcher,
        wait,
        monotonicNow: () => milliseconds,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
      expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
      expect(fetcher.mock.calls[0][1]?.body).toBe(
        fetcher.mock.calls[1][1]?.body,
      );
      expect(fetcher.mock.calls[0][1]?.signal).toBe(
        fetcher.mock.calls[1][1]?.signal,
      );
      expect(result.attempts).toEqual([
        {
          index: 1,
          status,
          durationMs: 30,
          requestBytes: expect.any(Number),
          retryDelayMs: 1000,
          usage: null,
          providerStatus: "INTERNAL",
        },
        {
          index: 2,
          status: 200,
          durationMs: 50,
          requestBytes: expect.any(Number),
          retryDelayMs: 0,
          usage: result.usage,
          providerStatus: null,
        },
      ]);
      expect(result.latencyMs).toBe(1080);
      expect(
        result.attempts?.every(
          (attempt) => GemmaAttemptSchema.safeParse(attempt).success,
        ),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /private-response|client-private|synthetic-google/,
      );
    },
  );

  it("exhausts exactly three attempts with 1s/2s backoff and unknown failed usage", async () => {
    const wait = vi.fn(async (_delay: number) => {});
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => transient(503, "UNAVAILABLE"));
    const error = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      now,
      fetcher,
      wait,
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(GoogleGemmaError);
    expect(fetcher).toHaveBeenCalledTimes(GOOGLE_GEMMA_MAX_ATTEMPTS);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000]);
    const failure = serializeGoogleGemmaFailure(error);
    expect(failure).toMatchObject({
      code: "provider_rejected",
      attempts: [
        {
          index: 1,
          status: 503,
          retryDelayMs: 1000,
          usage: null,
          providerStatus: "UNAVAILABLE",
        },
        {
          index: 2,
          status: 503,
          retryDelayMs: 2000,
          usage: null,
          providerStatus: "UNAVAILABLE",
        },
        {
          index: 3,
          status: 503,
          retryDelayMs: 0,
          usage: null,
          providerStatus: "UNAVAILABLE",
        },
      ],
    });
    expect(GoogleGemmaFailureSchema.safeParse(failure).success).toBe(true);
    expect(JSON.stringify(failure)).not.toMatch(
      /private|secret|responseId|message|details/,
    );
  });

  it.each([400, 401, 403, 408, 429, 501, 505])(
    "does not retry HTTP %i or retain an unknown provider status",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(transient(status, "PRIVATE_ACCOUNT_IDENTIFIER"));
      const wait = vi.fn(async () => {});
      const error = await generateGoogleGemmaProposal(requirements, {
        env: enabled,
        now,
        fetcher,
        wait,
      }).catch((error: unknown) => error);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(serializeGoogleGemmaFailure(error)).toMatchObject({
        code: "provider_rejected",
        attempts: [
          { status, providerStatus: null, usage: null, retryDelayMs: 0 },
        ],
      });
      expect(String(error)).not.toContain("PRIVATE_ACCOUNT");
    },
  );

  it("retains a known 200 usage receipt for an invalid plan without retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(completion([{ ...check, script: "private-code" }])),
      );
    const wait = vi.fn(async () => {});
    const error = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      now,
      fetcher,
      wait,
    }).catch((error: unknown) => error);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(serializeGoogleGemmaFailure(error)).toMatchObject({
      code: "invalid_plan",
      attempts: [
        {
          status: 200,
          usage: { promptTokens: 140, completionTokens: 45, totalTokens: 185 },
        },
      ],
    });
    expect(String(error)).not.toContain("private-code");
  });

  it("does not retry malformed HTTP200 output and preserves unknown usage", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not JSON"));
    const wait = vi.fn(async () => {});
    const error = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      now,
      fetcher,
      wait,
    }).catch((error: unknown) => error);
    expect(serializeGoogleGemmaFailure(error)).toMatchObject({
      code: "invalid_response",
      attempts: [{ status: 200, usage: null }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("does not retry fetch or error-body network failures", async () => {
    for (const fetcher of [
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("private network diagnostic")),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("private stream diagnostic"));
            },
          }),
          { status: 503 },
        ),
      ),
    ]) {
      const wait = vi.fn(async () => {});
      const error = await generateGoogleGemmaProposal(requirements, {
        env: enabled,
        now,
        fetcher,
        wait,
      }).catch((error: unknown) => error);
      expect(serializeGoogleGemmaFailure(error)?.code).toBe("request_failed");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(String(error)).not.toContain("private");
    }
  });

  it("bounds untrusted error JSON and strips unknown keys from safe serialization", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(65_537), { status: 401 }));
    const error = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      now,
      fetcher,
    }).catch((error: unknown) => error);
    expect(serializeGoogleGemmaFailure(error)).toMatchObject({
      code: "provider_rejected",
      attempts: [{ status: 401, usage: null, providerStatus: null }],
    });
    expect(serializeGoogleGemmaFailure(new Error("private"))).toBeNull();
    expect(
      GoogleGemmaFailureSchema.safeParse({ code: "arbitrary", attempts: [] })
        .success,
    ).toBe(false);
    expect(
      GoogleGemmaFailureSchema.safeParse({
        code: "request_failed",
        attempts: [],
        secret: "no",
      }).success,
    ).toBe(false);
  });

  it("does not schedule a retry whose backoff exhausts the shared deadline", async () => {
    let milliseconds = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      milliseconds = 29_100;
      return transient(500);
    });
    const wait = vi.fn(async () => {});
    const error = await generateGoogleGemmaProposal(requirements, {
      env: enabled,
      now,
      fetcher,
      wait,
      monotonicNow: () => milliseconds,
    }).catch((error: unknown) => error);
    expect(serializeGoogleGemmaFailure(error)).toMatchObject({
      code: "request_timeout",
      attempts: [{ status: 500, retryDelayMs: 0, usage: null }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("aborts a hung request at the one total deadline without retry", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Promise<Response>(() => {}));
      const wait = vi.fn(async () => {});
      const pending = generateGoogleGemmaProposal(requirements, {
        env: enabled,
        now,
        fetcher,
        wait,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await pending;
      expect(serializeGoogleGemmaFailure(error)).toMatchObject({
        code: "request_timeout",
        attempts: [{ status: null, usage: null, retryDelayMs: 0 }],
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares the deadline across a retry and a hung second response body", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(transient(500))
        .mockResolvedValueOnce(
          new Response(new ReadableStream({ start() {} }), { status: 200 }),
        );
      const pending = generateGoogleGemmaProposal(requirements, {
        env: enabled,
        now,
        fetcher,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(29_000);
      expect(serializeGoogleGemmaFailure(await pending)).toMatchObject({
        code: "request_timeout",
        attempts: [
          { status: 500, retryDelayMs: 1000 },
          { status: 200, usage: null, retryDelayMs: 0 },
        ],
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
