/**
 * Splits text into overlapping chunks for embedding.
 * Uses a sliding window approach optimized for research papers.
 */
export function chunkText(
  text: string,
  chunkSize: number = 512,
  overlap: number = 64
): string[] {
  // Clean up the text
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= chunkSize) {
    return [cleaned];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = start + chunkSize;

    // Try to break at a sentence boundary
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastPeriod = slice.lastIndexOf(". ");
      const lastNewline = slice.lastIndexOf("\n");
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > chunkSize * 0.3) {
        end = start + breakPoint + 1;
      }
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    start = end - overlap;
  }

  return chunks;
}

/**
 * Generates a simple unique ID.
 */
export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
