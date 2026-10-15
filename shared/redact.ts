/** Shared display normalization for browser evidence and its provenance. */
export function redact(input: string): string {
  return input
    .replace(
      /\b(?:Bearer\s+)?(?:sk[-_][A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gi,
      "[redacted credential]",
    )
    .replace(
      /(["']?\b(?:password|passwd|secret|token|api[ _-]?key|authorization)["']?\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi,
      "$1[redacted]",
    )
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9+\/_.=-]{6,}/gi,
      "[redacted authorization]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[redacted phone]")
    .slice(0, 6000);
}
