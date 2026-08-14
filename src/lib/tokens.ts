/**
 * Browser-local token estimation.
 *
 * ## Why this is an estimate
 *
 * Claude's real tokenizer is not published as a client-side library, and the
 * authoritative count comes from Anthropic's `POST /v1/messages/count_tokens`
 * endpoint — which needs an API key and a network round trip. This page has
 * neither by design, so it estimates instead.
 *
 * The estimator is a segment-weighted character model: text is split into
 * runs of similar character class, and each run is charged a different
 * characters-per-token rate. That handles the cases a flat `chars / 4` rule
 * gets badly wrong — code, CJK, whitespace runs, long digit strings.
 *
 * Expect roughly ±10% against the real tokenizer on prose and ±15% on code.
 * Never present the output as exact; the UI says so explicitly.
 */

export interface TokenEstimate {
  /** Estimated token count. */
  readonly tokens: number;
  /** Rough confidence band, ± this many tokens. */
  readonly margin: number;
  readonly characters: number;
  /** Characters excluding all whitespace. */
  readonly charactersNoSpaces: number;
  readonly words: number;
  readonly lines: number;
}

/**
 * Characters per token, by character class. Lower means denser: CJK
 * characters routinely cost about one token each, while ordinary English
 * prose averages close to four characters per token.
 */
const RATES = {
  /** Latin letters and common prose punctuation. */
  prose: 4.1,
  /** Runs of digits tokenize far more finely than letters. */
  digits: 2.2,
  /** Punctuation and symbol soup — typical of code and markup. */
  symbols: 2.4,
  /** CJK, Hangul, Kana: approximately one token per character. */
  cjk: 1.0,
  /** Runs of spaces/newlines merge into few tokens. */
  whitespace: 6.0,
} as const;

type Klass = keyof typeof RATES;

/** Classify a single code point into a pricing class. */
function classify(ch: string): Klass {
  if (/\s/.test(ch)) return 'whitespace';
  if (/[0-9]/.test(ch)) return 'digits';
  // CJK Unified Ideographs, Hiragana, Katakana, Hangul.
  if (/[぀-ヿ㐀-䶿一-鿿가-힯]/.test(ch)) return 'cjk';
  if (/[a-zA-ZÀ-ɏ'’,.]/.test(ch)) return 'prose';
  return 'symbols';
}

/**
 * Estimate the token count of `text`.
 *
 * Returns zeroed counts for empty input rather than throwing, so the UI can
 * call this unconditionally on every keystroke.
 */
export function estimateTokens(text: string): TokenEstimate {
  if (text.length === 0) {
    return { tokens: 0, margin: 0, characters: 0, charactersNoSpaces: 0, words: 0, lines: 0 };
  }

  // Tally characters per class, then convert each tally at its own rate.
  const tally: Record<Klass, number> = {
    prose: 0,
    digits: 0,
    symbols: 0,
    cjk: 0,
    whitespace: 0,
  };

  // Iterate by code point so surrogate pairs (emoji) count as one character.
  for (const ch of text) {
    tally[classify(ch)] += 1;
  }

  let tokens = 0;
  for (const klass of Object.keys(tally) as Klass[]) {
    tokens += tally[klass] / RATES[klass];
  }

  // Every message carries a small structural overhead beyond its raw text.
  tokens += 3;

  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

  return {
    tokens: Math.max(1, Math.round(tokens)),
    margin: Math.max(1, Math.round(tokens * 0.12)),
    characters: [...text].length,
    charactersNoSpaces: [...text].filter((c) => !/\s/.test(c)).length,
    words,
    lines: text.split('\n').length,
  };
}

/** Cost in USD for `tokens` at `pricePerMillion`. */
export function costOf(tokens: number, pricePerMillion: number): number {
  return (tokens / 1_000_000) * pricePerMillion;
}

/** Format a USD amount, keeping small figures legible rather than "$0.00". */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
