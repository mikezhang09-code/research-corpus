// Curated palette of cover emojis for notebooks.
// Mirrors the visual style Google's NotebookLM uses on its landing page —
// recognizable, varied, and friendly.
export const EMOJI_PALETTE = [
  "📚", "📖", "📝", "🎓", "🔬", "💼",
  "🎨", "🎵", "🎬", "⚔️", "👑", "🌍",
  "🚀", "💡", "🔥", "⭐", "🎯", "❤️",
  "🏆", "🧪", "🌟", "🌳", "🍕", "☕",
  "🐉", "🎭", "🧠", "⚡", "🎪", "🪐",
];

/** Stable hash of a string → integer in [0, 2^32). */
function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick a deterministic emoji from the palette based on the seed (e.g. notebook id).
 *  Used as a fallback when a notebook has no `cover_emoji` set. */
export function emojiFromSeed(seed: string): string {
  return EMOJI_PALETTE[hash(seed) % EMOJI_PALETTE.length];
}

/** Pick a random emoji from the palette (used as the default for new notebooks). */
export function randomEmoji(): string {
  return EMOJI_PALETTE[Math.floor(Math.random() * EMOJI_PALETTE.length)];
}
