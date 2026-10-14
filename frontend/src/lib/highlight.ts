/** Locate a passage (a chunk, whose whitespace was normalised) inside the original source text. */
export function findPassage(text: string, passage: string): [number, number] | null {
  const words = passage.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = (ws: string[]) => new RegExp(ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  // Match the start and the end separately so small differences in the middle don't break it.
  const head = pattern(words.slice(0, Math.min(12, words.length))).exec(text);
  if (!head) return null;
  const tailWords = words.slice(-Math.min(12, words.length));
  const tail = pattern(tailWords).exec(text.slice(head.index));
  const end = tail ? head.index + tail.index + tail[0].length : head.index + head[0].length;
  return [head.index, end];
}
