function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: num(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://rag:rag@localhost:5433/rag",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  embedModel: process.env.EMBED_MODEL ?? "nomic-embed-text",
  chatModel: process.env.CHAT_MODEL ?? "qwen2.5:7b",
  embedDim: num(process.env.EMBED_DIM, 768),
  chunkSize: num(process.env.CHUNK_SIZE, 800),
  chunkOverlap: num(process.env.CHUNK_OVERLAP, 150),
  topK: num(process.env.TOP_K, 5),
} as const;
