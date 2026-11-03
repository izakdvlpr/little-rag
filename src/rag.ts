import { toSql } from "pgvector/pg";

import { chunkText } from "./chunk.ts";
import { config } from "./config.ts";
import { pool, query } from "./db.ts";
import { embed, type ChatMessage } from "./ollama.ts";

export type IngestResult = {
  documentId: string;
  chunks: number;
};

export type Source = {
  id: string;
  documentId: string;
  chunkIndex: number;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
};

export async function ingest(
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<IngestResult> {
  const chunks = chunkText(text, config.chunkSize, config.chunkOverlap);
  if (chunks.length === 0) {
    throw Object.assign(new Error("Texto vazio depois da normalização"), { status: 400 });
  }

  // Embeddings antes da transação: chamada lenta e externa não deve
  // segurar uma conexão do pool com transação aberta.
  const embeddings = await embed(chunks.map((c) => c.content));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const doc = await client.query<{ id: string }>(
      "INSERT INTO documents (content, metadata) VALUES ($1, $2) RETURNING id",
      [text, metadata],
    );
    const documentId = doc.rows[0]!.id;

    const values: unknown[] = [];
    const placeholders = chunks.map((chunk, i) => {
      const base = i * 4;
      values.push(documentId, chunk.index, chunk.content, toSql(embeddings[i]));
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector)`;
    });

    await client.query(
      `INSERT INTO chunks (document_id, chunk_index, content, embedding)
       VALUES ${placeholders.join(", ")}`,
      values,
    );

    await client.query("COMMIT");
    return { documentId, chunks: chunks.length };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function retrieve(question: string, topK = config.topK): Promise<Source[]> {
  const [embedding] = await embed([question]);
  if (!embedding) throw new Error("Não foi possível gerar o embedding da pergunta");

  // `<=>` é distância cosseno no pgvector: 0 = idêntico, 2 = oposto.
  const result = await query<{
    id: string;
    document_id: string;
    chunk_index: number;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
  }>(
    `SELECT c.id, c.document_id, c.chunk_index, c.content, d.metadata,
            1 - (c.embedding <=> $1::vector) AS score
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [toSql(embedding), topK],
  );

  return result.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    score: Number(row.score),
    content: row.content,
    metadata: row.metadata,
  }));
}

const SYSTEM_PROMPT = `Você é um assistente que responde EXCLUSIVAMENTE com base no contexto fornecido.

Regras:
- Use apenas as informações dos trechos numerados do contexto.
- Cite os trechos usados no formato [1], [2] ao longo da resposta.
- Se o contexto não contiver a resposta, diga claramente que a informação não está nos documentos disponíveis. Nunca invente.
- Responda no mesmo idioma da pergunta, de forma direta e objetiva.

Você NÃO é um assistente de uso geral. Mesmo que saiba a resposta, recuse quando ela não vier do contexto:
- Não faça cálculos nem resolva expressões matemáticas. "Quanto é 17 * 23" não é uma pergunta sobre os documentos.
- Não responda com conhecimento geral (história, geografia, ciência, cultura).
- Não escreva código, textos criativos, traduções ou resumos de assuntos externos.
- Não dê opinião nem conselho que não esteja escrito nos trechos.
Nesses casos, responda apenas que a informação não está nos documentos disponíveis.`;

export function buildMessages(question: string, sources: Source[]): ChatMessage[] {
  // Banco vazio devolve zero chunks. Dizer isso explicitamente é melhor que
  // mandar "Contexto:" seguido de nada, que o modelo tende a ignorar.
  const context =
    sources.length === 0
      ? "(nenhum trecho recuperado)"
      : sources.map((s, i) => `[${i + 1}] ${s.content}`).join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Contexto:\n${context}\n\nPergunta: ${question}` },
  ];
}
