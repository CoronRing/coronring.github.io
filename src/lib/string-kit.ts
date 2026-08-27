/**
 * A registry of one-way and round-trip text transforms.
 *
 * ## Why a registry
 *
 * These are individually trivial and collectively the reason people keep a
 * browser tab open on a site that logs their input. Written as a registry, a new
 * transform is one object: a name, a note, and a function. Written as separate
 * components it would be a new page each time, and there would be six of them
 * instead of twenty.
 *
 * Each entry carries a `note` saying what it does *and where it is wrong*,
 * because the failure mode of a tool like this is a transform that looks right
 * and quietly corrupts one character in a thousand.
 *
 * The HTML-to-Markdown converter is the exception and lives in its own module,
 * `html-to-markdown.ts`. It is a parser, not a transform.
 *
 * Origin: the throwaway scripts in `string_action/`, which were each a file, a
 * hardcoded input path and a hardcoded output path.
 */

export type TransformGroup = 'case' | 'code' | 'encode' | 'lines' | 'clean' | 'inspect';

export interface Transform {
  readonly id: string;
  readonly name: string;
  readonly group: TransformGroup;
  /** What it does, and where it stops being safe. */
  readonly note: string;
  /** Applied to the input. Throwing is fine: the caller reports the message. */
  readonly run: (input: string) => string;
  /** The reverse transform, where there is an exact one. */
  readonly inverse?: string;
  /** Preloaded example, so the tool is never a pair of empty boxes. */
  readonly sample?: string;
}

export const TRANSFORM_GROUPS: Record<TransformGroup, string> = {
  case: 'Case',
  code: 'Code literals',
  encode: 'Encoding',
  lines: 'Lines',
  clean: 'Cleanup',
  inspect: 'Inspect',
};

/* ── Word splitting ───────────────────────────────────────────────────── */

/**
 * Split an identifier into words, whatever convention it was written in.
 *
 * The acronym rule is the part that is usually wrong. A naive camelCase split
 * turns `parseHTTPResponse` into `parse`, `H`, `T`, `T`, `P`, `Response`. The
 * lookahead here keeps a run of capitals together and gives up its last letter
 * only when a lowercase letter follows, which yields `parse`, `HTTP`,
 * `Response`.
 */
function words(input: string): string[] {
  return input
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

const upperFirst = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/* ── Title case ───────────────────────────────────────────────────────── */

/**
 * Words that stay lowercase inside a title, per Chicago style.
 *
 * Excludes prepositions of five letters or more (`between`, `through`), which
 * Chicago capitalises and most naive implementations do not.
 */
const MINOR_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'yet',
  'so',
  'as',
  'at',
  'by',
  'in',
  'of',
  'off',
  'on',
  'per',
  'to',
  'up',
  'via',
  'from',
  'into',
  'like',
  'near',
  'onto',
  'over',
  'past',
  'than',
  'with',
]);

function titleCase(input: string): string {
  const tokens = input.toLowerCase().split(/(\s+|[-–—:;,.!?()[\]"'])/);
  let isFirstWord = true;
  const out = tokens.map((token, index) => {
    if (!/\p{L}/u.test(token)) {
      // A colon or a full stop restarts the title, so the next word capitalises
      // even if it is "the".
      if (/[.:!?]/.test(token)) isFirstWord = true;
      return token;
    }
    const last = tokens.slice(index + 1).every((rest) => !/\p{L}/u.test(rest));
    const minor = MINOR_WORDS.has(token);
    const result = isFirstWord || last || !minor ? upperFirst(token) : token;
    isFirstWord = false;
    return result;
  });
  return out.join('');
}

/* ── Code literals ────────────────────────────────────────────────────── */

/**
 * Text to a Python string literal.
 *
 * Chooses the quote style that needs the least escaping, then triple-quotes
 * anything multi-line. This is the `copied_text_to_string` script from
 * `string_action/`, minus the hardcoded file paths.
 */
function toPythonLiteral(input: string): string {
  if (input.includes('\n')) {
    const quote = input.includes('"""') ? "'''" : '"""';
    // A trailing quote character would close the literal early.
    const body = input.replace(/\\/g, '\\\\').replace(/(["'])$/, '\\$1');
    return `${quote}\\\n${body}${quote}`;
  }
  const single = (input.match(/'/g) ?? []).length;
  const double = (input.match(/"/g) ?? []).length;
  const quote = double <= single ? '"' : "'";
  const escaped = input
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(quote, 'g'), `\\${quote}`)
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `${quote}${escaped}${quote}`;
}

/**
 * A quoted literal back to the text it holds.
 *
 * Handles Python and JavaScript escapes, including `\xNN`, `\uNNNN` and
 * `\u{NNNNN}`. Octal escapes are not handled: they are ambiguous with `\0`
 * followed by a digit and are effectively extinct in both languages.
 */
function fromCodeLiteral(input: string): string {
  let body = input.trim();
  for (const quote of ['"""', "'''", '"', "'", '`']) {
    if (body.startsWith(quote) && body.endsWith(quote) && body.length >= quote.length * 2) {
      body = body.slice(quote.length, -quote.length);
      break;
    }
  }
  return body.replace(
    /\\(u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r?\n|.)/g,
    (whole, token: string, braced?: string, unicode?: string, hex?: string) => {
      if (braced) return String.fromCodePoint(parseInt(braced, 16));
      if (unicode) return String.fromCharCode(parseInt(unicode, 16));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      // A backslash before a real newline is a line continuation: both go.
      if (token.startsWith('\n') || token.startsWith('\r')) return '';
      const simple: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        '0': '\0',
        b: '\b',
        f: '\f',
        v: '\v',
        '\\': '\\',
        "'": "'",
        '"': '"',
        '`': '`',
      };
      return simple[token] ?? whole;
    },
  );
}

/* ── Encoding ─────────────────────────────────────────────────────────── */

/**
 * UTF-8 safe Base64.
 *
 * `btoa` operates on Latin-1 and throws on any character above U+00FF, so the
 * text goes through `TextEncoder` first. The naive `btoa(text)` version works
 * on English and fails on the first accented character or emoji, which is the
 * kind of bug that ships.
 */
function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  // Chunked: spreading a large Uint8Array into `apply` overflows the argument
  // limit somewhere around 100 kB, and does it as a RangeError.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function fromBase64(input: string): string {
  // Accept the URL-safe alphabet and missing padding, since that is what turns
  // up in a JWT.
  const normalised = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');

  // Checked before `atob`, which throws `InvalidCharacterError: Invalid
  // character` and names neither the character nor its position. Pointing at the
  // offending byte is the difference between a usable error and a shrug.
  const bad = /[^A-Za-z0-9+/=]/.exec(normalised);
  if (bad) {
    throw new Error(
      `Not valid Base64: ${JSON.stringify(bad[0])} at position ${bad.index + 1} is not in the alphabet. If this is a URL or a data: URI, decode that part first.`,
    );
  }

  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(
      'Not valid Base64: the length is wrong even after padding, so at least one character is missing.',
    );
  }
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

const HTML_ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
];

/**
 * Decode entities using the browser's own table.
 *
 * A hand-rolled map covers the five named entities everyone remembers and
 * misses the 2,226 others. The parser knows all of them, and `textContent` off
 * an inert document reads the decoded text without executing anything.
 */
function decodeEntities(input: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${input}`, 'text/html');
  return doc.body.textContent ?? '';
}

/* ── The registry ─────────────────────────────────────────────────────── */

export const TRANSFORMS: readonly Transform[] = [
  /* ── Case ──────────────────────────────────────────────────────── */
  {
    id: 'camel',
    name: 'camelCase',
    group: 'case',
    note: 'Splits on any separator and on case changes. Runs of capitals stay together, so parseHTTPResponse survives a round trip.',
    run: (input) =>
      words(input)
        .map((word, i) => (i === 0 ? word.toLowerCase() : upperFirst(word.toLowerCase())))
        .join(''),
    sample: 'parse HTTP response  parse_http_response  ParseHTTPResponse',
  },
  {
    id: 'pascal',
    name: 'PascalCase',
    group: 'case',
    note: 'Same splitting as camelCase, with the first word capitalised too.',
    run: (input) =>
      words(input)
        .map((word) => upperFirst(word.toLowerCase()))
        .join(''),
  },
  {
    id: 'snake',
    name: 'snake_case',
    group: 'case',
    note: 'Lowercase words joined with underscores. Punctuation is dropped, not transliterated.',
    run: (input) =>
      words(input)
        .map((word) => word.toLowerCase())
        .join('_'),
  },
  {
    id: 'constant',
    name: 'CONSTANT_CASE',
    group: 'case',
    note: 'Uppercase snake case. What an environment variable wants.',
    run: (input) =>
      words(input)
        .map((word) => word.toUpperCase())
        .join('_'),
  },
  {
    id: 'kebab',
    name: 'kebab-case',
    group: 'case',
    note: 'Lowercase words joined with hyphens.',
    run: (input) =>
      words(input)
        .map((word) => word.toLowerCase())
        .join('-'),
  },
  {
    id: 'slug',
    name: 'URL slug',
    group: 'case',
    note: 'Kebab case after Unicode decomposition, so café becomes cafe rather than caf. Non-Latin scripts have no ASCII form and are dropped, which the character count will show.',
    run: (input) =>
      input
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    sample: 'Café Naïve — Résumé & Co. (2026 edition)',
  },
  {
    id: 'title',
    name: 'Title Case',
    group: 'case',
    note: 'Chicago style: minor words stay lowercase unless they open or close the title. It cannot know that "US" is an acronym rather than the word "us".',
    run: titleCase,
    sample: 'the quick brown fox jumps over a lazy dog: a study of speed',
  },
  {
    id: 'sentence',
    name: 'Sentence case',
    group: 'case',
    note: 'Capitalises after . ! ? and a newline. An abbreviation such as "e.g." starts a new sentence as far as this is concerned.',
    run: (input) =>
      input
        .toLowerCase()
        .replace(
          /(^|[.!?]\s+|\n\s*)(\p{Ll})/gu,
          (_, lead: string, ch: string) => lead + ch.toUpperCase(),
        ),
  },
  {
    id: 'upper',
    name: 'UPPERCASE',
    group: 'case',
    note: 'Locale-independent uppercase. Turkish dotless i is not handled, because a locale-aware version would depend on the visitor’s browser settings.',
    run: (input) => input.toUpperCase(),
  },
  {
    id: 'lower',
    name: 'lowercase',
    group: 'case',
    note: 'Locale-independent lowercase.',
    run: (input) => input.toLowerCase(),
  },
  {
    id: 'swap',
    name: 'Swap case',
    group: 'case',
    note: 'Inverts each letter. Occasionally useful, mostly for testing a case-insensitive comparison.',
    run: (input) =>
      input.replace(/\p{L}/gu, (ch) =>
        ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase(),
      ),
  },

  /* ── Code literals ─────────────────────────────────────────────── */
  {
    id: 'to-python',
    name: 'Text to Python string',
    group: 'code',
    note: 'Picks the quote style needing the fewest escapes and triple-quotes anything multi-line. The replacement for the copied_text_to_string script.',
    run: toPythonLiteral,
    inverse: 'from-literal',
    sample: 'He said "it\'s fine" and\nleft at 3\ttoday.',
  },
  {
    id: 'to-json-string',
    name: 'Text to JSON string',
    group: 'code',
    note: 'A double-quoted JSON string, escapes and all. Valid in JavaScript too.',
    run: (input) => JSON.stringify(input),
    inverse: 'from-literal',
  },
  {
    id: 'from-literal',
    name: 'String literal to text',
    group: 'code',
    note: 'Strips the outer quotes and resolves \\n, \\t, \\xNN, \\uNNNN and \\u{...}. Octal escapes are left alone: they are ambiguous and effectively extinct.',
    run: fromCodeLiteral,
    inverse: 'to-python',
    sample: '"Line one\\nLine two\\tindented \\u2014 done"',
  },
  {
    id: 'to-c-lines',
    name: 'Text to quoted lines',
    group: 'code',
    note: 'One quoted, comma-separated literal per line. For pasting a word list into an array.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => `${JSON.stringify(line)},`)
        .join('\n'),
  },

  /* ── Encoding ──────────────────────────────────────────────────── */
  {
    id: 'base64-encode',
    name: 'Base64 encode',
    group: 'encode',
    note: 'UTF-8 first, then Base64, so emoji and accented characters survive. The bare btoa version throws on both.',
    run: toBase64,
    inverse: 'base64-decode',
    sample: 'Résumé 2026 — 100% ✅',
  },
  {
    id: 'base64-decode',
    name: 'Base64 decode',
    group: 'encode',
    note: 'Accepts the URL-safe alphabet and missing padding, so a JWT segment decodes without editing. Invalid bytes become the replacement character rather than an error.',
    run: fromBase64,
    inverse: 'base64-encode',
  },
  {
    id: 'url-encode',
    name: 'URL encode',
    group: 'encode',
    note: 'encodeURIComponent: escapes everything a query-string value must escape, including / and &. Use this for a value, not for a whole URL.',
    run: (input) => encodeURIComponent(input),
    inverse: 'url-decode',
    sample: 'q=particle wave&tag=a/b?c#d',
  },
  {
    id: 'url-decode',
    name: 'URL decode',
    group: 'encode',
    note: 'Does not convert + to a space: that is form encoding, not URL encoding, and guessing wrong corrupts a legitimate plus sign.',
    run: (input) => decodeURIComponent(input.trim()),
    inverse: 'url-encode',
  },
  {
    id: 'html-escape',
    name: 'HTML escape',
    group: 'encode',
    note: 'Escapes the five characters that matter, ampersand first so an already-escaped entity is not double-escaped in the wrong order.',
    run: (input) => HTML_ENTITIES.reduce((acc, [ch, entity]) => acc.split(ch).join(entity), input),
    inverse: 'html-unescape',
    sample: '<a href="/x?a=1&b=2">it\'s here</a>',
  },
  {
    id: 'html-unescape',
    name: 'HTML unescape',
    group: 'encode',
    note: 'Uses the browser’s own entity table, so all 2,231 named entities resolve rather than the five everyone remembers. Parsed inert: no script runs.',
    run: decodeEntities,
    inverse: 'html-escape',
  },
  {
    id: 'hex',
    name: 'To hex bytes',
    group: 'encode',
    note: 'UTF-8 bytes, space separated. Byte count, not character count: an emoji is four bytes.',
    run: (input) =>
      [...new TextEncoder().encode(input)].map((b) => b.toString(16).padStart(2, '0')).join(' '),
    inverse: 'from-hex',
  },
  {
    id: 'from-hex',
    name: 'From hex bytes',
    group: 'encode',
    note: 'Accepts spaces, colons, 0x prefixes and newlines between bytes. An odd digit count is an error rather than a guess.',
    run: (input) => {
      const digits = input.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
      if (digits.length % 2 !== 0) throw new Error('Odd number of hex digits: one is missing.');
      const bytes = new Uint8Array(digits.length / 2);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
      }
      return new TextDecoder().decode(bytes);
    },
    inverse: 'hex',
  },
  {
    id: 'unicode-escape',
    name: 'Escape non-ASCII',
    group: 'encode',
    note: 'Replaces every character above U+007F with \\uNNNN, using surrogate pairs above the BMP. For a config file that must be pure ASCII.',
    run: (input) =>
      input.replace(/[^\x20-\x7E\n\r\t]/g, (ch) =>
        [...ch].map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
      ),
    inverse: 'from-literal',
  },

  /* ── Lines ─────────────────────────────────────────────────────── */
  {
    id: 'sort',
    name: 'Sort lines',
    group: 'lines',
    note: 'Locale-aware, so accented letters sort next to their base letter and 10 comes after 9 rather than after 1.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .join('\n'),
    sample: 'item10\nitem9\nÉclair\napple\nBanana\napple',
  },
  {
    id: 'sort-desc',
    name: 'Sort lines, reversed',
    group: 'lines',
    note: 'The same comparison, inverted.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .join('\n'),
  },
  {
    id: 'dedupe',
    name: 'Remove duplicate lines',
    group: 'lines',
    note: 'Keeps the first occurrence and the original order. Exact match, so trailing whitespace makes two lines distinct: normalise whitespace first if that is not what you want.',
    run: (input) => [...new Set(input.split(/\r?\n/))].join('\n'),
  },
  {
    id: 'reverse-lines',
    name: 'Reverse line order',
    group: 'lines',
    note: 'Last line first. For reading a log written oldest-first.',
    run: (input) => input.split(/\r?\n/).reverse().join('\n'),
  },
  {
    id: 'number-lines',
    name: 'Number lines',
    group: 'lines',
    note: 'Right-aligned to the widest number, so the text stays in one column.',
    run: (input) => {
      const lines = input.split(/\r?\n/);
      const width = String(lines.length).length;
      return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}  ${line}`).join('\n');
    },
  },
  {
    id: 'join',
    name: 'Join lines with commas',
    group: 'lines',
    note: 'Blank lines are dropped and each line is trimmed. For turning a pasted column into a list.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join(', '),
  },
  {
    id: 'split-sentences',
    name: 'One sentence per line',
    group: 'lines',
    note: 'Splits after . ! ? followed by a space and a capital. Abbreviations such as "Dr." and "e.g." will split wrongly: a regex cannot tell a full stop from an abbreviation point.',
    run: (input) => input.replace(/([.!?]["’”)]?)\s+(?=[\p{Lu}“"(])/gu, '$1\n').trim(),
  },

  /* ── Cleanup ───────────────────────────────────────────────────── */
  {
    id: 'trim-lines',
    name: 'Trim each line',
    group: 'clean',
    note: 'Removes leading and trailing whitespace per line. Indentation goes with it.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .join('\n'),
  },
  {
    id: 'collapse-space',
    name: 'Collapse whitespace',
    group: 'clean',
    note: 'Every run of whitespace, newlines included, becomes one space. The result is a single paragraph.',
    run: (input) => input.replace(/\s+/g, ' ').trim(),
  },
  {
    id: 'strip-blank',
    name: 'Remove blank lines',
    group: 'clean',
    note: 'Drops lines that are empty or whitespace only.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .join('\n'),
  },
  {
    id: 'unwrap',
    name: 'Unwrap paragraphs',
    group: 'clean',
    note: 'Joins hard-wrapped lines back into paragraphs, keeping blank lines as breaks. A line ending in a hyphen is rejoined without it, which is right for a PDF and wrong for a hyphenated compound at a line end.',
    run: (input) =>
      input
        .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
        .replace(/([^\n])\n(?![\n\s*\-\d>#])/gu, '$1 ')
        .replace(/[ \t]{2,}/g, ' '),
    sample:
      'This paragraph was hard-\nwrapped at eighty columns by\nsomebody’s editor.\n\nThis one is separate.',
  },
  {
    id: 'normalise-quotes',
    name: 'Straighten quotes and dashes',
    group: 'clean',
    note: 'Curly quotes to straight, en and em dashes to hyphens, ellipsis to three dots, non-breaking space to a space. What a document needs before it goes into code.',
    run: (input) =>
      input
        .replace(/[‘’‚‛′]/g, "'")
        .replace(/[“”„‟″]/g, '"')
        .replace(/[–—―]/g, '-')
        .replace(/…/g, '...')
        .replace(/[   ]/g, ' '),
    sample: '“It’s fine” — she said… maybe not.',
  },
  {
    id: 'nfkc',
    name: 'Normalise Unicode (NFKC)',
    group: 'clean',
    note: 'Folds compatibility forms: full-width characters become ASCII, ligatures split, and lookalike characters used to smuggle text past a filter collapse to their plain forms.',
    run: (input) => input.normalize('NFKC'),
    sample: 'Ｔｈｅ ｆｕｌｌ－ｗｉｄｔｈ ﬁle',
  },
  {
    id: 'strip-invisible',
    name: 'Remove invisible characters',
    group: 'clean',
    note: 'Drops zero-width spaces, joiners, byte-order marks, directional overrides and other control characters that survive a copy and paste and then break a comparison that looks like it should pass.',
    // Written as escapes rather than the characters themselves. A regex literal
    // cannot span lines, and U+2028 and U+2029 *are* line terminators to a
    // JavaScript parser, so the literal form of this class is a syntax error.
    run: (input) =>
      input.replace(
        /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff\ufff9-\ufffb]/g,
        '',
      ),
  },
  {
    id: 'strip-ansi',
    name: 'Remove ANSI colour codes',
    group: 'clean',
    note: 'Strips the escape sequences a terminal uses for colour, so a copied build log reads as text.',
    run: (input) => input.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, ''),
  },
  {
    id: 'tabs-to-spaces',
    name: 'Tabs to spaces',
    group: 'clean',
    note: 'Two spaces per tab, expanded to the next stop rather than substituted, so alignment is preserved.',
    run: (input) =>
      input
        .split(/\r?\n/)
        .map((line) => {
          let out = '';
          for (const ch of line) out += ch === '\t' ? ' '.repeat(2 - (out.length % 2)) : ch;
          return out;
        })
        .join('\n'),
  },

  /* ── Inspect ───────────────────────────────────────────────────── */
  {
    id: 'codepoints',
    name: 'List code points',
    group: 'inspect',
    note: 'One line per character with its code point and name category. The tool for "these two strings look identical but do not compare equal".',
    run: (input) =>
      [...input.slice(0, 4000)]
        .map((ch) => {
          const point = ch.codePointAt(0) ?? 0;
          const label =
            point === 32
              ? 'SPACE'
              : point === 10
                ? 'LINE FEED'
                : point === 9
                  ? 'TAB'
                  : point < 32 || point === 127
                    ? 'CONTROL'
                    : JSON.stringify(ch);
          return `U+${point.toString(16).toUpperCase().padStart(4, '0')}  ${String(point).padStart(7)}  ${label}`;
        })
        .join('\n'),
    sample: 'A​B é́ 🚀',
  },
  {
    id: 'char-frequency',
    name: 'Character frequency',
    group: 'inspect',
    note: 'Descending count per character, whitespace shown by name. Counts code points, so an emoji counts once rather than twice.',
    run: (input) => {
      const counts = new Map<string, number>();
      for (const ch of input) counts.set(ch, (counts.get(ch) ?? 0) + 1);
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 300)
        .map(([ch, count]) => {
          const label =
            ch === ' ' ? '(space)' : ch === '\n' ? '(newline)' : ch === '\t' ? '(tab)' : ch;
          return `${String(count).padStart(7)}  ${label}`;
        })
        .join('\n');
    },
  },
  {
    id: 'word-frequency',
    name: 'Word frequency',
    group: 'inspect',
    note: 'Case-folded, apostrophes kept inside words. No stop-word list, so "the" will lead: that is a corpus decision, not a text-tool one.',
    run: (input) => {
      const counts = new Map<string, number>();
      for (const word of input.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ??
        []) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 500)
        .map(([word, count]) => `${String(count).padStart(7)}  ${word}`)
        .join('\n');
    },
  },
  {
    id: 'reverse',
    name: 'Reverse characters',
    group: 'inspect',
    note: 'Reverses by code point, not by UTF-16 unit, so an emoji survives instead of turning into two broken halves. Combining marks still end up on the wrong letter, which no reversal can avoid.',
    run: (input) => [...input].reverse().join(''),
  },
];

/** Look a transform up by id. */
export function findTransform(id: string): Transform | undefined {
  return TRANSFORMS.find((transform) => transform.id === id);
}

/* ── Text statistics ──────────────────────────────────────────────────── */

export interface TextStats {
  readonly chars: number;
  readonly charsNoSpaces: number;
  readonly bytes: number;
  readonly words: number;
  readonly lines: number;
  readonly sentences: number;
  readonly paragraphs: number;
  /** Distinct code points. High relative to length means dense or mixed-script text. */
  readonly uniqueChars: number;
}

/**
 * Count everything a text box should report.
 *
 * `chars` counts code points and `bytes` counts UTF-8, and both are shown
 * because they differ by a factor of four on emoji and by nothing at all on
 * English, which is exactly when someone hits a length limit they thought they
 * were under.
 */
export function textStats(input: string): TextStats {
  const trimmed = input.trim();
  return {
    chars: [...input].length,
    charsNoSpaces: [...input.replace(/\s/g, '')].length,
    bytes: new TextEncoder().encode(input).length,
    words:
      trimmed === '' ? 0 : (trimmed.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length,
    lines: input === '' ? 0 : input.split(/\r?\n/).length,
    sentences: trimmed === '' ? 0 : (trimmed.match(/[.!?。！？]+(?:\s|$)/g) ?? []).length || 1,
    paragraphs: trimmed === '' ? 0 : trimmed.split(/\n\s*\n/).filter((p) => p.trim() !== '').length,
    uniqueChars: new Set([...input]).size,
  };
}
