import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDocument,
  ingest,
  ingestFiles,
  listDocuments,
  type DocumentRow,
  type UploadResult,
} from "../lib/api";

function UploadBox({ onDone }: { onDone: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    setResults([]);

    try {
      setResults(await ingestFiles(files));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha no upload");
    } finally {
      setBusy(false);
      // Permite reenviar o mesmo arquivo: sem isso o input não dispara change.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition ${
          dragging ? "border-blue-500 bg-blue-500/10" : "border-edge bg-panel hover:border-zinc-600"
        }`}
      >
        <p className="text-sm text-zinc-300">
          {busy ? "Enviando e gerando embeddings…" : "Arraste arquivos .txt aqui"}
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          ou clique para escolher · até 10 arquivos · 5MB cada
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((r) => (
            <li key={r.file} className="flex items-center gap-2 text-xs">
              <span className={r.ok ? "text-emerald-400" : "text-red-400"}>{r.ok ? "✓" : "✕"}</span>
              <span className="truncate text-zinc-400">{r.file}</span>
              <span className="text-zinc-600">
                {r.ok ? `${r.chunks} chunk(s)` : r.error}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Documents() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "erro"; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocuments());
    } catch (err) {
      setStatus({ kind: "erro", message: err instanceof Error ? err.message : "erro" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setStatus(null);

    try {
      const metadata = source.trim() ? { source: source.trim() } : {};
      const result = await ingest(text, metadata);
      setStatus({ kind: "ok", message: `documento criado com ${result.chunks} chunk(s)` });
      setText("");
      setSource("");
      await refresh();
    } catch (err) {
      setStatus({ kind: "erro", message: err instanceof Error ? err.message : "erro" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteDocument(id);
      await refresh();
    } catch (err) {
      setStatus({ kind: "erro", message: err instanceof Error ? err.message : "erro" });
    }
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6">
      <section>
        <h2 className="text-sm font-medium text-zinc-300">Enviar arquivos</h2>
        <div className="mt-3">
          <UploadBox onDone={() => void refresh()} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-zinc-300">Ou colar texto</h2>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Cole aqui o texto que vira chunks + embeddings…"
          className="mt-3 w-full resize-y rounded-lg border border-edge bg-panel px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-blue-600"
        />

        <div className="mt-2 flex items-center gap-2">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="metadata.source (opcional)"
            className="flex-1 rounded-lg border border-edge bg-panel px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-blue-600"
          />
          <button
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Processando…" : "Ingerir"}
          </button>
        </div>

        {status && (
          <p
            className={`mt-2 text-xs ${status.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}
          >
            {status.message}
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-zinc-300">
          Documentos <span className="text-zinc-600">({docs.length})</span>
        </h2>

        {docs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">nenhum documento ingerido ainda</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-300">
                    {typeof doc.metadata.source === "string" ? doc.metadata.source : "(sem source)"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {doc.chunks} chunk(s) · {doc.length} chars ·{" "}
                    {new Date(doc.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>

                <code className="hidden shrink-0 font-mono text-xs text-zinc-600 sm:block">
                  {doc.id.slice(0, 8)}
                </code>

                <button
                  onClick={() => void remove(doc.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-red-600/15 hover:text-red-400"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export const Route = createFileRoute("/documents")({ component: Documents });
