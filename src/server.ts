import express, { type NextFunction, type Request, type Response } from "express";

import { config } from "./config.ts";
import { pool } from "./db.ts";
import { listModels } from "./ollama.ts";
import { chatRouter } from "./routes/chat.ts";
import { ingestRouter } from "./routes/ingest.ts";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/health", async (_req, res) => {
  const [db, ollama] = await Promise.all([
    pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false),
    listModels().catch(() => null),
  ]);

  const healthy = db && ollama !== null;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    db,
    ollama: ollama !== null,
    models: ollama ?? [],
    config: {
      embedModel: config.embedModel,
      chatModel: config.chatModel,
      embedDim: config.embedDim,
      topK: config.topK,
    },
  });
});

app.use(ingestRouter);
app.use(chatRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);

  if (res.headersSent) {
    res.end();
    return;
  }

  // 22P02 = invalid_text_representation, ex: uuid malformado na URL.
  const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
  const status =
    code === "22P02"
      ? 400
      : (typeof err === "object" && err !== null ? (err as { status?: number }).status : undefined) ??
        500;

  res.status(status).json({
    error: err instanceof Error ? err.message : "Erro interno",
  });
});

const server = app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}`);
  console.log(`[server] embed=${config.embedModel} chat=${config.chatModel}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} recebido, encerrando`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
