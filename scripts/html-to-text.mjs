/**
 * A small, dependency-free HTML → plain-text extractor.
 *
 * Why hand-rolled rather than `node-html-parser` or `turndown`: the only HTML
 * this ever sees is HTML this repo just generated, so the hostile-input cases a
 * general parser exists to survive cannot arise. In exchange the build keeps
 * zero extra supply-chain surface, which is the trade the rest of the site makes.
 *
 * It is a *scanner*, not a regex sweep. Attribute values are allowed to contain
 * `>` (they routinely do — inline SVG paths, JSON in `data-` attributes), and a
 * `/<[^>]+>/g` pass silently truncates those tags and corrupts everything after
 * them. Quote state is tracked so that cannot happen.
 *
 * The output is Markdown-ish: headings keep their level, lists keep their
 * bullets, code keeps its fence. That is deliberate — the text is destined for
 * an LLM prompt, and structure it can see is structure it can ground a citation
 * in.
 */

/** Elements whose entire subtree is dropped — chrome, decoration, scripting. */
const DROP_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'audio',
  'video',
  'nav',
  'form',
]);

/** Elements whose content is text but never markup. */
const RAW_TEXT = new Set(['script', 'style', 'template']);

/** HTML void elements — they never have a closing tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements that force a paragraph break around their content. */
const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const NAMED_ENTITIES = new Map(
  Object.entries({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    shy: '',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    laquo: '«',
    raquo: '»',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    middot: '·',
    bull: '•',
    deg: '°',
    times: '×',
    minus: '−',
    copy: '©',
    reg: '®',
    trade: '™',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
  }),
);

/**
 * Decode the HTML entities that actually appear in generated markup.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Reject NaN, surrogates, and out-of-range code points rather than
      // throwing out of String.fromCodePoint in the middle of a build.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return '';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES.get(body);
    return named === undefined ? match : named;
  });
}

/**
 * @typedef {{ type: 'text', value: string }
 *   | { type: 'open', name: string, attrs: Record<string, string>, selfClosing: boolean }
 *   | { type: 'close', name: string }} HtmlToken
 */

/**
 * Tokenize HTML, tracking quote state so `>` inside an attribute is safe.
 *
 * @param {string} html
 * @returns {HtmlToken[]}
 */
export function tokenize(html) {
  /** @type {HtmlToken[]} */
  const out = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out.push({ type: 'text', value: html.slice(i) });
      break;
    }
    if (lt > i) out.push({ type: 'text', value: html.slice(i, lt) });

    // Comments, doctype, processing instructions — skipped wholesale.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Walk to the tag's real end, ignoring `>` inside quoted attribute values.
    let j = lt + 1;
    let quote = '';
    while (j < n) {
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j += 1;
    }
    if (j >= n) {
      // Unterminated tag — treat the remainder as text and stop.
      out.push({ type: 'text', value: html.slice(lt) });
      break;
    }

    const inner = html.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith('/')) {
      out.push({ type: 'close', name: inner.slice(1).trim().toLowerCase() });
      continue;
    }

    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(inner);
    if (!nameMatch) continue;
    const name = nameMatch[0].toLowerCase();
    const selfClosing = inner.endsWith('/');

    /** @type {Record<string, string>} */
    const attrs = {};
    const attrRe =
      /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
    attrRe.lastIndex = nameMatch[0].length;
    let m;
    while ((m = attrRe.exec(inner)) !== null) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
    }

    out.push({ type: 'open', name, attrs, selfClosing });
  }

  return out;
}

/**
 * Should this element's subtree be dropped from the extracted text?
 *
 * `aria-hidden` and `hidden` are honoured because the site uses them for pure
 * decoration — HUD rings, particle fields, corner ticks. Anything a screen
 * reader is told to ignore is also noise to a language model.
 * `data-corpus-skip` is the explicit opt-out for UI that is neither hidden nor
 * content: the chat dock must not end up inside the corpus it answers from.
 *
 * @param {string} name
 * @param {Record<string, string>} attrs
 * @returns {boolean}
 */
function isDropped(name, attrs) {
  if (DROP_ELEMENTS.has(name)) return true;
  if (attrs['aria-hidden'] === 'true') return true;
  if ('hidden' in attrs) return true;
  if ('data-corpus-skip' in attrs) return true;
  return false;
}

/**
 * Extract readable, lightly-structured text from an HTML fragment.
 *
 * @param {string} html
 * @returns {string} Markdown-ish text, paragraph-separated, entity-decoded.
 */
export function htmlToText(html) {
  const tokens = tokenize(html);

  /** @type {string[]} Finished blocks. */
  const blocks = [];
  /** Text accumulating for the block currently being built. */
  let current = '';
  /** Depth counter — greater than zero means we are inside a dropped subtree. */
  let dropDepth = 0;
  /** Open element names inside the drop, so the matching close lifts it. */
  const dropStack = [];
  /** Open list count, so nested lists indent. */
  let listDepth = 0;
  let inPre = false;
  /** Pending prefix for the block being built (`## `, `- `). */
  let prefix = '';

  const flush = () => {
    const text = inPre ? current.replace(/\s+$/, '') : current.replace(/\s+/g, ' ').trim();
    if (text) blocks.push(prefix + text);
    current = '';
    prefix = '';
  };

  for (const token of tokens) {
    if (token.type === 'text') {
      if (dropDepth === 0) current += decodeEntities(token.value);
      continue;
    }

    if (token.type === 'open') {
      const { name, attrs, selfClosing } = token;

      if (dropDepth > 0) {
        // Track nesting so the matching close tag lifts the drop correctly.
        if (!selfClosing && !VOID_ELEMENTS.has(name)) dropStack.push(name);
        continue;
      }

      if (isDropped(name, attrs)) {
        if (!selfClosing && !VOID_ELEMENTS.has(name)) {
          dropDepth = 1;
          dropStack.length = 0;
          dropStack.push(name);
        }
        continue;
      }

      if (name === 'br') {
        current += inPre ? '\n' : ' ';
        continue;
      }
      if (name === 'hr') {
        flush();
        continue;
      }
      if (name === 'img') {
        // Alt text is real content — it is what a non-visual reader gets.
        const alt = (attrs.alt ?? '').trim();
        if (alt) current += ` ${alt} `;
        continue;
      }

      if (BLOCK_ELEMENTS.has(name)) flush();

      if (/^h[1-6]$/.test(name)) {
        prefix = `${'#'.repeat(Number(name[1]))} `;
      } else if (name === 'li') {
        prefix = `${'  '.repeat(Math.max(0, listDepth - 1))}- `;
      } else if (name === 'ul' || name === 'ol') {
        listDepth += 1;
      } else if (name === 'pre') {
        inPre = true;
      }
      continue;
    }

    // Close tag.
    const { name } = token;

    if (dropDepth > 0) {
      const idx = dropStack.lastIndexOf(name);
      if (idx !== -1) {
        dropStack.length = idx;
        if (dropStack.length === 0) dropDepth = 0;
      }
      continue;
    }

    if (name === 'pre') {
      flush();
      inPre = false;
      continue;
    }
    if (name === 'ul' || name === 'ol') {
      flush();
      listDepth = Math.max(0, listDepth - 1);
      continue;
    }
    if (BLOCK_ELEMENTS.has(name)) {
      flush();
      continue;
    }
    if (RAW_TEXT.has(name)) continue;
  }

  flush();

  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
