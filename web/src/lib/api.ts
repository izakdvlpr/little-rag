export type Source = {
  ref: number;
  id: string;
  documentId: string;
  chunkIndex: number;
  score: number;
  metadata: Record<string, unknown>;
  preview: string;
};

export type DocumentRow = {
  id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  length: number;
  chunks: number;
};

export type Health = {
  status: string;
  db: boolean;
  ollama: boolean;
  models: string[];
  config: {
    embedModel: string;
    chatModel: string;
    embedDim: number;
    topK: number;
  };
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const getHealth = () => json<Health>("/health");
export const listDocuments = () => json<DocumentRow[]>("/documents");

export const deleteDocument = (id: string) =>
  json<{ deleted: string }>(`/documents/${id}`, { method: "DELETE" });

export const ingest = (text: string, metadata: Record<string, unknown>) =>
  json<{ documentId: string; chunks: number }>("/ingest", {
    method: "POST",
    body: JSON.stringify({ text, metadata }),
  });

export type UploadResult =
  | { file: string; ok: true; documentId: string; chunks: number }
  | { file: string; ok: false; error: string };

/** Upload de .txt. Um arquivo inválido não invalida os outros do mesmo envio. */
export async function ingestFiles(files: File[]): Promise<UploadResult[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);

  // Sem content-type manual: o browser precisa gerar o boundary do multipart.
  const res = await fetch("/api/ingest/file", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as {
    results?: UploadResult[];
    error?: string;
  };

  if (body.results) return body.results;
  throw new Error(body.error ?? `HTTP ${res.status}`);
}

type ChatHandlers = {
  onSources: (sources: Source[]) => void;
  onToken: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

/**
 * Consome o SSE do /chat. EventSource só faz GET, então é fetch + reader manual.
 * Retorna quando o stream fecha; aborte pelo `signal` para cancelar.
 */
export async function streamChat(
  question: string,
  topK: number,
  handlers: ChatHandlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, topK }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("resposta sem corpo");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      // Eventos SSE são separados por linha em branco.
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const raw = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !raw) continue;

        const data = JSON.parse(raw) as unknown;
        if (event === "sources") handlers.onSources(data as Source[]);
        else if (event === "token") handlers.onToken((data as { text: string }).text);
        else if (event === "error") handlers.onError((data as { message: string }).message);
        else if (event === "done") {
          handlers.onDone();
          return;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
