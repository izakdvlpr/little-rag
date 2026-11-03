import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { streamChat, type Source } from "../lib/api";

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: string;
};

function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  // Banco vazio devolve zero trechos — nada de útil a mostrar.
  if (sources.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-zinc-500 transition hover:text-zinc-300"
      >
        {open ? "▾" : "▸"} {sources.length} trecho{sources.length > 1 ? "s" : ""} recuperado
        {sources.length > 1 ? "s" : ""}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-md border border-edge bg-ink/60 p-2.5 text-xs">
              <div className="mb-1 flex items-center gap-2 text-zinc-500">
                <span className="font-mono text-zinc-300">[{s.ref}]</span>
                <span>score {s.score.toFixed(3)}</span>
                <span>· chunk {s.chunkIndex}</span>
                {typeof s.metadata.source === "string" && (
                  <span className="truncate">· {s.metadata.source}</span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-zinc-400">{s.preview}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [topK, setTopK] = useState(5);
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Aborta o stream se o componente desmontar no meio da geração.
  useEffect(() => () => abortRef.current?.abort(), []);

  function patchLast(patch: (m: Message) => Message) {
    setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? patch(m) : m)));
  }

  async function send() {
    const question = input.trim();
    if (!question || streaming) return;

    setInput("");
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        question,
        topK,
        {
          onSources: (sources) => patchLast((m) => ({ ...m, sources })),
          onToken: (text) => patchLast((m) => ({ ...m, content: m.content + text })),
          onDone: () => {},
          onError: (message) => patchLast((m) => ({ ...m, error: message })),
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        patchLast((m) => ({ ...m, error: err instanceof Error ? err.message : "erro" }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 && (
          <div className="mt-20 text-center text-sm text-zinc-500">
            <p>Faça uma pergunta sobre os documentos ingeridos.</p>
            <p className="mt-1 text-zinc-600">
              Sem documentos ainda? Vá em <span className="text-zinc-400">Documentos</span> e cole
              algum texto.
            </p>
          </div>
        )}

        {messages.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-2xl rounded-bl-sm border border-edge bg-panel px-4 py-3">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
                {streaming && i === messages.length - 1 && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400 align-text-bottom" />
                )}
              </p>

              {message.error && (
                <p className="mt-2 text-xs text-red-400">erro: {message.error}</p>
              )}

              {message.sources && <SourceList sources={message.sources} />}
            </div>
          ),
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-edge py-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Pergunte algo…  (Enter envia, Shift+Enter quebra linha)"
            className="flex-1 resize-none rounded-lg border border-edge bg-panel px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-blue-600"
          />

          {streaming ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="self-stretch rounded-lg bg-red-600 px-4 text-sm font-medium transition hover:bg-red-500"
            >
              Parar
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim()}
              className="self-stretch rounded-lg bg-blue-600 px-4 text-sm font-medium transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Enviar
            </button>
          )}
        </div>

        <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
          topK
          <input
            type="number"
            min={1}
            max={20}
            value={topK}
            onChange={(e) => setTopK(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 rounded border border-edge bg-panel px-2 py-1 text-zinc-300 outline-none focus:border-blue-600"
          />
          trechos enviados como contexto
        </label>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({ component: Chat });
