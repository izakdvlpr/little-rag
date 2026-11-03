export type Chunk = {
  index: number;
  content: string;
};

/** Quebra um bloco grande demais em pedaços <= size, cortando em fim de frase. */
function splitOversized(text: string, size: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    // Frase única maior que o limite: corta na força bruta.
    if (sentence.length > size) {
      if (current) {
        parts.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += size) {
        parts.push(sentence.slice(i, i + size));
      }
      continue;
    }

    if (current.length + sentence.length > size) {
      parts.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Divide o texto em chunks de até `size` caracteres, respeitando parágrafos,
 * com `overlap` caracteres do chunk anterior repetidos no início do seguinte
 * (evita perder contexto que cai bem em cima de uma fronteira).
 */
export function chunkText(text: string, size: number, overlap: number): Chunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).flatMap((p) => {
    const trimmed = p.trim();
    if (!trimmed) return [];
    return trimmed.length > size ? splitOversized(trimmed, size) : [trimmed];
  });

  const blocks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= size) {
      current += `\n\n${paragraph}`;
    } else {
      blocks.push(current);
      current = paragraph;
    }
  }
  if (current) blocks.push(current);

  const safeOverlap = Math.max(0, Math.min(overlap, size - 1));

  return blocks.map((block, index) => {
    if (index === 0 || safeOverlap === 0) return { index, content: block };
    const previous = blocks[index - 1] ?? "";
    const tail = previous.slice(-safeOverlap);
    return { index, content: `${tail}\n\n${block}`.trim() };
  });
}
