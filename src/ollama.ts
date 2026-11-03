import { config } from "./config.ts";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function ollamaFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${config.ollamaUrl}${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama ${path} respondeu ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

/** Lista os modelos disponíveis. Usado pelo /health. */
export async function listModels(): Promise<string[]> {
  const res = await ollamaFetch("/api/tags", { method: "GET" });
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name);
}

/** Gera embeddings em lote — uma única chamada para todos os textos. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await ollamaFetch("/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.embedModel, input: texts }),
  });

  const body = (await res.json()) as { embeddings?: number[][] };
  const embeddings = body.embeddings;

  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error(
      `Ollama devolveu ${embeddings?.length ?? 0} embeddings para ${texts.length} textos`,
    );
  }

  const dim = embeddings[0]?.length ?? 0;
  if (dim !== config.embedDim) {
    throw new Error(
      `Modelo ${config.embedModel} produz vetores de ${dim} dimensões, ` +
        `mas o schema espera ${config.embedDim}. Ajuste EMBED_DIM e sql/init.sql.`,
    );
  }

  return embeddings;
}

type ChatChunk = {
  message?: { content?: string };
  done?: boolean;
};

/**
 * Streama a resposta do chat token a token.
 * A resposta do Ollama é NDJSON (um JSON por linha), não SSE.
 */
export async function* chatStream(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await ollamaFetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.chatModel, messages, stream: true }),
    signal,
  });

  if (!res.body) throw new Error("Ollama /api/chat não devolveu corpo");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        const chunk = JSON.parse(line) as ChatChunk;
        const text = chunk.message?.content;
        if (text) yield text;
        if (chunk.done) return;
      }
    }
  } finally {
    // Cancela o corpo da resposta se o consumidor parou no meio
    // (cliente desconectou), para o Ollama não seguir gerando.
    await reader.cancel().catch(() => {});
  }
}
