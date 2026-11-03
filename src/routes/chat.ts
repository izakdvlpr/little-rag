import { Router } from "express";

import { config } from "../config.ts";
import { chatStream } from "../ollama.ts";
import { buildMessages, retrieve } from "../rag.ts";

export const chatRouter = Router();

const PREVIEW_LENGTH = 200;

chatRouter.post("/chat", async (req, res, next) => {
  const { question, topK } = req.body ?? {};

  if (typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "Campo `question` é obrigatório e não pode ser vazio" });
    return;
  }

  const limit = Number.isInteger(topK) && topK > 0 && topK <= 50 ? topK : config.topK;

  // Recupera antes de abrir o SSE: se o banco ou o embedding falharem,
  // ainda dá para responder com status code de verdade.
  let sources;
  try {
    sources = await retrieve(question, limit);
  } catch (err) {
    next(err);
    return;
  }

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Cliente sumiu no meio do stream: aborta o fetch para o Ollama
  // parar de gerar tokens que ninguém vai ler.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log("[chat] cliente desconectou, abortando geração");
      controller.abort();
    }
  });

  send(
    "sources",
    sources.map((s, i) => ({
      ref: i + 1,
      id: s.id,
      documentId: s.documentId,
      chunkIndex: s.chunkIndex,
      score: Number(s.score.toFixed(4)),
      metadata: s.metadata,
      preview:
        s.content.length > PREVIEW_LENGTH
          ? `${s.content.slice(0, PREVIEW_LENGTH)}…`
          : s.content,
    })),
  );

  try {
    for await (const token of chatStream(buildMessages(question, sources), controller.signal)) {
      send("token", { text: token });
    }
    send("done", { finishReason: "stop" });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error("[chat] erro durante o stream:", err);
    send("error", { message: err instanceof Error ? err.message : "erro desconhecido" });
  } finally {
    res.end();
  }
});
