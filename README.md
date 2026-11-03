# little-rag

RAG local: Express + Postgres/pgvector + Ollama. TypeScript rodando nativo no Node 24, sem build step.

Fluxo: você envia texto → ele é quebrado em chunks → cada chunk vira um embedding (`nomic-embed-text`) → guardado no Postgres. Na pergunta, busca os chunks mais próximos por distância cosseno e manda como contexto pro LLM (`qwen2.5:7b`), que responde citando as fontes.

## Requisitos

- Node >= 22 (testado no v24.12)
- Docker + Docker Compose
- Ollama rodando local

```bash
ollama pull nomic-embed-text   # embeddings, 768 dimensões
ollama pull qwen2.5:7b         # geração da resposta
```

## Subir

```bash
npm install
npm run db:up      # Postgres+pgvector na porta 5433 do host
npm run dev        # API em http://localhost:3000
```

Front (opcional, em outro terminal):

```bash
cd web
npm install
npm run dev        # http://localhost:5180
```

O schema (`sql/init.sql`) roda sozinho no primeiro boot do container. Para zerar tudo: `npm run db:reset`.

## Configuração

Tudo tem default embutido em `src/config.ts` — o `.env` é opcional. Para sobrescrever, crie um `.env` na raiz:

```
PORT=3000
DATABASE_URL=postgres://rag:rag@localhost:5433/rag
OLLAMA_URL=http://localhost:11434
EMBED_MODEL=nomic-embed-text
CHAT_MODEL=qwen2.5:7b
EMBED_DIM=768
CHUNK_SIZE=800
CHUNK_OVERLAP=150
TOP_K=5
```

> A porta do host é **5433** porque a 5432 já estava ocupada por outro container nesta máquina.

> Trocar de modelo de embedding muda a dimensão do vetor (`mxbai-embed-large` = 1024). Você precisa ajustar `EMBED_DIM` **e** o `vector(768)` em `sql/init.sql`, depois rodar `npm run db:reset`. O `embed()` valida a dimensão e falha explicitamente se houver divergência.

## API

### `GET /health`

Checa Postgres e Ollama.

```json
{ "status": "ok", "db": true, "ollama": true, "models": ["nomic-embed-text:latest", "qwen2.5:7b"] }
```

### `POST /ingest`

```bash
curl -X POST localhost:3000/ingest -H 'content-type: application/json' -d '{
  "text": "Texto que vai virar chunks e embeddings.",
  "metadata": { "source": "manual" }
}'
```

→ `201 { "documentId": "…", "chunks": 3 }`

### `POST /ingest/file`

Upload de `.txt` via `multipart/form-data`, campo `files`. Até 10 arquivos por envio, 5MB cada. O nome do arquivo vira `metadata.source`.

```bash
curl -X POST localhost:3000/ingest/file \
  -F files=@samples/manual-cafeteira-zx900.txt \
  -F files=@samples/faq-suporte-nimbus.txt
```

→ `201 { "results": [ { "file": "…", "ok": true, "documentId": "…", "chunks": 5 } ] }`

O resultado é **por arquivo**: um `.txt` inválido no meio do lote não descarta os que deram certo. A resposta só é `400` quando nenhum arquivo passou.

Rejeições: extensão diferente de `.txt`, arquivo vazio, acima de 5MB, e binário renomeado para `.txt` (detectado por byte nulo). BOM UTF-8 é removido automaticamente.

### `POST /chat` — SSE

```bash
curl -N -X POST localhost:3000/chat -H 'content-type: application/json' \
  -d '{"question": "Qual modelo de embedding o projeto usa?", "topK": 5}'
```

Eventos, nesta ordem:

| evento    | payload                                                         |
| --------- | --------------------------------------------------------------- |
| `sources` | `[{ ref, id, documentId, chunkIndex, score, metadata, preview }]` |
| `token`   | `{ text }` — um por token                                        |
| `done`    | `{ finishReason: "stop" }`                                       |
| `error`   | `{ message }` — só se falhar no meio do stream                   |

`sources` chega **antes** do primeiro token, então a UI já mostra as fontes enquanto a resposta digita. `score` é `1 - distância_cosseno` (1.0 = idêntico).

Se o cliente desconectar no meio, o servidor aborta a geração no Ollama em vez de deixá-la terminar à toa.

Consumo no browser (`EventSource` só faz GET, então use `fetch`):

```js
const res = await fetch("/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question }),
});

const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += value;

  const blocks = buffer.split("\n\n");
  buffer = blocks.pop() ?? "";

  for (const block of blocks) {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const data = JSON.parse(block.match(/^data: (.+)$/m)[1]);
    if (event === "token") process.stdout.write(data.text);
  }
}
```

### `GET /documents` / `DELETE /documents/:id`

Lista documentos com contagem de chunks; delete remove os chunks junto (`ON DELETE CASCADE`).

## Ficando dentro do escopo

O `retrieve()` sempre devolve os `topK` mais próximos — por pior que seja o match. Não há limiar: se a pergunta não tem nada a ver com o acervo, o LLM recebe mesmo assim um bloco `Contexto:` com os chunks menos ruins, e cabe a ele perceber que não servem.

Quem segura isso é o system prompt, que além de "responda só pelo contexto" proíbe explicitamente cálculo, conhecimento geral, código e opinião. Funciona na maior parte dos casos, mas é instrução em linguagem natural, não filtro — ver limitações.

## Arquivos de exemplo

`samples/` tem quatro `.txt` fictícios de domínios distintos, para dar o que testar sem precisar inventar conteúdo:

| arquivo | conteúdo | boas perguntas |
| --- | --- | --- |
| `manual-cafeteira-zx900.txt` | manual de uma cafeteira, com códigos de erro e descalcificação | *"O que significa o erro E02?"* · *"Posso usar vinagre para descalcificar?"* |
| `politica-ferias-nimbus.txt` | política de férias de uma empresa fictícia | *"Qual a antecedência mínima para pedir férias?"* · *"Quantos dias de licença-paternidade?"* |
| `changelog-api-orbita.txt` | changelog de API com quebras de compatibilidade | *"A partir de qual versão o valor passou a ser em centavos?"* |
| `faq-suporte-nimbus.txt` | FAQ de suporte com SLAs e severidades | *"Qual o SLA de primeira resposta para um S1?"* |

Sobem juntos em ~18 chunks. Como os domínios não se sobrepõem, dá para conferir se o retrieval trouxe o documento certo olhando o painel de fontes.

Para subir todos de uma vez pela linha de comando:

```bash
curl -X POST localhost:3000/ingest/file $(for f in samples/*.txt; do echo -n "-F files=@$f "; done)
```

## Front (`web/`)

Vite + React 19 + TanStack Router (rotas em arquivo) + Tailwind v4. Existe só para testar a API na mão.

- **`/`** — chat. Streaming token a token com cursor piscando, botão **Parar** que aborta a geração, painel colapsável com os trechos recuperados (score, índice do chunk, preview) e controle de `topK`.
- **`/documents`** — dropzone de arquivos `.txt` (arrastar ou clicar, múltiplos de uma vez) com resultado por arquivo; ou colar texto direto definindo `metadata.source`. Abaixo, a lista de documentos com contagem de chunks e botão de remover.

O header mostra um badge de saúde da API com os modelos em uso.

O Vite faz proxy de `/api/*` → `http://localhost:3000`, então não há CORS envolvido. A porta é **5180** com `strictPort: true` — a 5173 costuma estar ocupada por outro projeto, e sem `strictPort` o Vite migra de porta em silêncio, o que faz o front parecer quebrado.

`src/routeTree.gen.ts` é gerado pelo plugin do TanStack Router ao rodar `dev`/`build`. Num clone limpo, rode um dos dois antes de `npm run typecheck`.

## Estrutura

```
src/
├── config.ts        env vars com defaults
├── db.ts            pool do pg
├── ollama.ts        embed() em lote + chatStream() (NDJSON → async generator)
├── chunk.ts         split por parágrafo, com fallback por frase e overlap
├── rag.ts           ingest(), retrieve(), buildMessages()
├── server.ts        app, /health, error handler, shutdown
└── routes/
    ├── ingest.ts
    └── chat.ts

web/src/
├── lib/api.ts       cliente + parser de SSE
├── main.tsx         router
└── routes/
    ├── __root.tsx   layout, nav, badge de health
    ├── index.tsx    chat
    └── documents.tsx
```

## Notas de implementação

- **Embedding antes da transação.** `ingest()` chama o Ollama *antes* do `BEGIN`, para não segurar uma conexão do pool aberta durante uma chamada externa lenta.
- **`pgvector.registerType` não é usado.** Ele só serve para desserializar colunas `vector` de volta em `number[]`, e nenhuma query aqui faz `SELECT embedding`. Registrá-lo no evento `connect` (síncrono no `pg`) dispara uma query concorrente na mesma conexão. A escrita usa `toSql()`.
- **Índice HNSW** com `vector_cosine_ops`, casando com o operador `<=>` usado no `ORDER BY`.
- **Overlap de chunk** repete os últimos `CHUNK_OVERLAP` caracteres do chunk anterior no início do seguinte, para não perder informação que cai em cima de uma fronteira.

## Limitações conhecidas

- Busca puramente vetorial — sem BM25/keyword híbrido nem re-ranking. Para bases grandes, adicionar um reranker melhora bastante a precisão.
- **Sem limiar de relevância.** Toda pergunta recebe contexto, relevante ou não, e a recusa depende do system prompt. Aritmética é o caso que mais escapa: o modelo não vê "quanto é 17 * 23" como violação de "use só o contexto", porque a resposta é *derivada*, não *lembrada*. Um limiar por score resolveria de forma determinística, mas exige calibração por corpus.
- **`/chat` é single-turn.** O front manda só a pergunta atual, sem histórico. Follow-ups sem assunto explícito ("me dá mais detalhes") embedam mal e recuperam chunks aleatórios — repita o assunto na pergunta.
- O modelo às vezes cita um índice que não existe (responde `[2]` com apenas um trecho no contexto). A resposta em si continua vindo do contexto correto; é a numeração da citação que escorrega.
- Sem paginação em `GET /documents`.
- `qwen2.5:7b` ocasionalmente derrapa para outro idioma no fim de respostas longas. É comportamento do modelo, não do pipeline — um modelo maior ou um `temperature` menor reduz isso.
- Sem autenticação. É um serviço local.
