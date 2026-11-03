import pg from "pg";

import { config } from "./config.ts";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Sem pgvector.registerType aqui de propósito: ele só serve para desserializar
// colunas `vector` de volta em number[], e nenhuma query deste projeto
// seleciona `embedding`. Registrá-lo no evento `connect` (que é síncrono no pg)
// dispararia uma query concorrente na mesma conexão. Escrita usa toSql().

pool.on("error", (err) => {
  console.error("[db] erro em cliente ocioso:", err);
});

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
