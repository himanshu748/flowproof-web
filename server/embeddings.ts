export async function embed(text: string): Promise<number[] | null> {
  if (process.env.FLOWPROOF_EMBEDDINGS !== "true") return null;
  const base = new URL(process.env.OLLAMA_URL || "http://127.0.0.1:11434");
  if (
    base.protocol !== "http:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new Error(
      "Embedding inference is limited to a local Ollama service.",
    );
  try {
    const response = await fetch(new URL("/api/embed", base), {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.FLOWPROOF_EMBEDDING_MODEL || "all-minilm:22m",
        input: text.slice(0, 4000),
        truncate: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let bytes = 0;
    let responseText = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 100000) {
        await reader.cancel();
        return null;
      }
      responseText += decoder.decode(chunk.value, { stream: true });
    }
    responseText += decoder.decode();
    const result = JSON.parse(responseText) as { embeddings?: number[][] };
    const vector = result.embeddings?.[0];
    if (!vector || vector.length !== 384 || !vector.every(Number.isFinite))
      return null;
    const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    return norm ? vector.map((x) => x / norm) : null;
  } catch {
    return null;
  }
}
