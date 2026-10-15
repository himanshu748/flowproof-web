import { z } from "zod";
import type { Audit } from "../../shared/types.js";
import {
  boundedBytes,
  ProviderError,
  providerKey,
  providerRequest,
  type ProviderOptions,
} from "./free-resource-policy.js";

export function sampleNarration(audit: Audit): string {
  if (
    audit.status !== "completed" ||
    audit.source?.target !== "sample" ||
    !audit.results.length ||
    audit.results.length > 24
  )
    throw new ProviderError(
      "invalid_input",
      "Free speech is restricted to a completed synthetic sample audit.",
    );
  const status = z.enum(["passed", "failed", "blocked", "unverified"]);
  if (!audit.results.every((result) => status.safeParse(result.status).success))
    throw new ProviderError(
      "invalid_input",
      "The sample contains an unsupported result status.",
    );
  const count = (value: string) =>
    audit.results.filter((result) => result.status === value).length;
  // No project names, requirements, expected values, DOM, URLs, or model commentary are transmitted.
  return `Briefstamp synthetic demonstration report. The browser recorded ${count("passed")} passed checks, ${count("failed")} failed checks, ${count("blocked")} blocked checks, and ${count("unverified")} unverified checks. Review each requirement and its screenshot in the written report. Blocked and unverified checks are not passes. This is a sample demonstration, not customer acceptance or certification of an entire website.`;
}

/** Noncommercial sample audio only: the public Free plan does not include a commercial license. */
export async function createSpokenSampleReport(
  audit: Audit,
  options: ProviderOptions = {},
) {
  const key = providerKey("elevenlabs", options);
  const text = sampleNarration(audit);
  const voice = (options.env ?? process.env).ELEVENLABS_VOICE_ID;
  if (!voice || !/^[A-Za-z0-9]{20}$/.test(voice))
    throw new ProviderError(
      "not_configured",
      "Configure an available stock voice ID; voice cloning is unsupported.",
    );
  if (
    (options.env ?? process.env).BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO !==
    "true"
  )
    throw new ProviderError(
      "license_confirmation_required",
      "Confirm this is a noncommercial synthetic demonstration before using free speech.",
    );
  const endpoint = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
  );
  endpoint.searchParams.set("output_format", "mp3_22050_32");
  const response = await providerRequest(
    "elevenlabs",
    endpoint,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    },
    "sample-speech",
    text.length,
    "characters",
    options,
  );
  if (
    !(response.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("audio/mpeg")
  ) {
    await response.body?.cancel();
    throw new ProviderError(
      "invalid_response",
      "ElevenLabs did not return MP3 audio.",
    );
  }
  const audio = await boundedBytes(response, 2 * 1024 * 1024);
  if (!audio.length)
    throw new ProviderError(
      "invalid_response",
      "ElevenLabs returned empty audio.",
    );
  const rawCost = response.headers.get("character-cost");
  const reportedCharacters =
    rawCost !== null && /^\d+$/.test(rawCost) ? Number(rawCost) : null;
  return {
    provider: "ElevenLabs",
    audio,
    mimeType: "audio/mpeg" as const,
    narration: text,
    reservedCharacters: text.length,
    reportedCharacters,
    attribution:
      "Voice generated with ElevenLabs. Noncommercial synthetic demonstration only.",
    limitation:
      "Audio reads recorded status counts and is not additional verification. No commercial license is claimed.",
  };
}
