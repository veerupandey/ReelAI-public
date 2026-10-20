/**
 * Shared language for "recreate this reference" asks.
 * Used by the studio parser and the loop intent router so they never drift.
 */
export const RECREATE_INTENT_RE =
  /\b(recreate|remake|replicate|clone|copy\s+the\s+(style|structure|pacing)|match\s+(this|the)\s+(ad|reel|video|reference|structure|beats?|pacing)|inspired\s+by\s+this|same\s+(structure|beats?|pacing)|reference\s+video)\b/i;

export function looksLikeRecreateIntent(text: string): boolean {
  return RECREATE_INTENT_RE.test(text || '');
}
