/**
 * HTML to Markdown, written against the DOM rather than against a regex.
 *
 * ## Why not a library
 *
 * Turndown is the obvious answer and a good one. It is not used here for one
 * reason: the hard part of this job is not the conversion, it is deciding *what
 * to convert*. Raw HTML off a real page is 80% navigation, cookie banners,
 * share buttons and script tags, and a faithful converter faithfully renders
 * all of it. So this module is mostly a content extractor with a serialiser
 * attached, and the serialiser is the small half.
 *
 * ## Why the DOM
 *
 * The browser already has a spec-compliant, injection-safe HTML parser, and it
 * is the same one that decides what the markup means. `DOMParser` gets malformed
 * tables, implied `<tbody>`, unclosed `<p>`, and entity decoding right for free.
 * A regex converter gets all four wrong, and gets them wrong quietly.
 *
 * Nothing parsed here is ever inserted into the live document: `DOMParser`
 * builds an inert tree, scripts do not run in it, and only text is read back
 * out. That is what makes it safe to point at a stranger's HTML.
 *
 * @see src/components/tools/StringKit.tsx for the UI over this.
 */

/* ── Options ──────────────────────────────────────────────────────────── */

export interface MarkdownOptions {
  /**
   * Strip chrome and keep the main content.
   *
   * Off, the whole body converts. On, the scoring pass below picks the element
   * that looks like an article.
   */
  readonly extractMain: boolean;
  /** `-` for bullets, `*` where the output is headed somewhere fussy. */
  readonly bullet: '-' | '*';
  /** ATX (`## Heading`) or Setext (underlined) for the top two levels. */
  readonly headings: 'atx' | 'setext';
  /** `_emphasis_` or `*emphasis*`. */
  readonly emphasis: '_' | '*';
  /** Keep images as `![alt](src)`, or drop them and keep the alt text. */
  readonly images: 'keep' | 'alt-only' | 'drop';
  /** Collect links as reference definitions at the end instead of inline. */
  readonly referenceLinks: boolean;
  /** Wrap paragraphs at this column. 0 leaves them on one line. */
  readonly wrap: number;
  /** Keep tables as GitHub pipe tables. Off, they degrade to lists. */
  readonly tables: boolean;
}

export const DEFAULT_OPTIONS: MarkdownOptions = {
  extractMain: true,
  bullet: '-',
  headings: 'atx',
  emphasis: '_',
  images: 'keep',
  referenceLinks: false,
  wrap: 0,
  tables: true,
};

export interface ConversionReport {
  readonly markdown: string;
  /** Which element the content was taken from, when extraction ran. */
  readonly extractedFrom?: string;
  /** Elements dropped wholesale, by tag, so nothing vanishes silently. */
  readonly dropped: ReadonlyArray<{ readonly tag: string; readonly count: number }>;
  /** Tags that had no Markdown equivalent and were unwrapped to their contents. */
  readonly unhandled: readonly string[];
  readonly stats: {
    readonly inputChars: number;
    readonly outputChars: number;
    readonly headings: number;
    readonly links: number;
    readonly images: number;
    readonly codeBlocks: number;
    readonly tables: number;
  };
  readonly error?: string;
}

/* ── Removal ──────────────────────────────────────────────────────────── */

/**
 * Elements with no textual content worth keeping.
 *
 * `<noscript>` is on the list because its *contents* are markup that was never
 * meant to render alongside the rest, and including it duplicates whatever the
 * script would have produced.
 */
const DROP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'form',
  'dialog',
]);

/**
 * Structural chrome, dropped only when extraction is on.
 *
 * Kept separate from `DROP_TAGS` because a `<nav>` is real content in a page
 * whose whole point is a link list, and someone converting a fragment by hand
 * should get what they pasted.
 */
const CHROME_TAGS = new Set(['nav', 'aside', 'footer', 'header']);

/**
 * Class and id fragments that mark chrome on essentially every CMS.
 *
 * Substring matching on class names is a blunt instrument and it is the one
 * that works. The list is conservative: `comment` is here, `content` is not,
 * because half the web wraps the article in something called `content-wrapper`.
 */
const CHROME_HINTS = [
  'nav',
  'menu',
  'sidebar',
  'side-bar',
  'breadcrumb',
  'footer',
  'header',
  'banner',
  'cookie',
  'consent',
  'gdpr',
  'newsletter',
  'subscribe',
  'signup',
  'social',
  'share',
  'related',
  'recommend',
  'promo',
  'advert',
  'sponsor',
  'popup',
  'modal',
  'overlay',
  'toolbar',
  'pagination',
  'comment',
  'disqus',
  'skip-link',
  'screen-reader',
  'sr-only',
  'visually-hidden',
];

/* ── Entry point ──────────────────────────────────────────────────────── */

/**
 * Convert an HTML document or fragment to Markdown.
 *
 * @param html Raw HTML. A full document, a fragment, or something in between.
 * @param options Serialisation and extraction settings.
 * @returns The Markdown plus an account of what was thrown away.
 */
export function htmlToMarkdown(html: string, options: MarkdownOptions): ConversionReport {
  const dropped = new Map<string, number>();
  const unhandled = new Set<string>();
  const counters = { headings: 0, links: 0, images: 0, codeBlocks: 0, tables: 0 };

  if (html.trim() === '') {
    return {
      markdown: '',
      dropped: [],
      unhandled: [],
      stats: { inputChars: 0, outputChars: 0, ...counters },
    };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch (error) {
    return {
      markdown: '',
      dropped: [],
      unhandled: [],
      stats: { inputChars: html.length, outputChars: 0, ...counters },
      error: error instanceof Error ? error.message : 'The HTML could not be parsed.',
    };
  }

  const body = doc.body;
  if (!body) {
    return {
      markdown: '',
      dropped: [],
      unhandled: [],
      stats: { inputChars: html.length, outputChars: 0, ...counters },
      error: 'No body element. The input may not be HTML.',
    };
  }

  // Comments are dropped before anything else. They regularly carry an entire
  // duplicate copy of the page from a templating system, and they are invisible
  // to the scoring pass, which would then score the duplicate.
  removeComments(body);
  prune(body, options.extractMain, dropped);

  const root = options.extractMain ? pickMain(body) : body;

  const state: State = {
    options,
    counters,
    unhandled,
    links: [],
    linkIndex: new Map(),
  };

  let markdown = tidy(renderChildren(root, state, ''));

  if (options.referenceLinks && state.links.length > 0) {
    const definitions = state.links
      .map((link, i) => `[${i + 1}]: ${link.href}${link.title ? ` "${link.title}"` : ''}`)
      .join('\n');
    markdown = `${markdown}\n\n${definitions}`;
  }

  return {
    markdown,
    extractedFrom: options.extractMain && root !== body ? describe(root) : undefined,
    dropped: [...dropped.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    unhandled: [...unhandled].sort(),
    stats: { inputChars: html.length, outputChars: markdown.length, ...counters },
  };
}

/* ── Cleaning ─────────────────────────────────────────────────────────── */

function removeComments(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, 128 /* SHOW_COMMENT */);
  const doomed: Node[] = [];
  while (walker.nextNode()) doomed.push(walker.currentNode);
  for (const node of doomed) node.parentNode?.removeChild(node);
}

/** Remove everything that cannot carry content, counting as it goes. */
function prune(root: Element, aggressive: boolean, dropped: Map<string, number>): void {
  const doomed: Element[] = [];

  for (const element of root.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();

    if (DROP_TAGS.has(tag)) {
      doomed.push(element);
      continue;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      doomed.push(element);
      continue;
    }
    // `hidden` and `display: none` in a style attribute are the two ways a
    // static document hides content. Computed style is unavailable in an inert
    // document, so the inline attribute is all there is to read.
    if (
      element.hasAttribute('hidden') ||
      /display\s*:\s*none/i.test(element.getAttribute('style') ?? '')
    ) {
      doomed.push(element);
      continue;
    }
    if (aggressive) {
      if (CHROME_TAGS.has(tag) && !isInsideArticle(element)) {
        doomed.push(element);
        continue;
      }
      if (looksLikeChrome(element)) doomed.push(element);
    }
  }

  for (const element of doomed) {
    // A parent may already have taken this node with it.
    if (!element.parentNode) continue;
    const tag = element.tagName.toLowerCase();
    dropped.set(tag, (dropped.get(tag) ?? 0) + 1);
    element.remove();
  }
}

/**
 * Is this element inside the article proper?
 *
 * A `<header>` inside `<article>` is usually the headline and byline, which is
 * content. A `<header>` at the top of `<body>` is the site banner, which is not.
 */
function isInsideArticle(element: Element): boolean {
  return element.parentElement?.closest('article, main') !== null;
}

function looksLikeChrome(element: Element): boolean {
  const signature = `${element.className} ${element.id}`.toLowerCase();
  if (signature.trim() === '') return false;
  if (!CHROME_HINTS.some((hint) => signature.includes(hint))) return false;
  // A hint plus a lot of prose is a false positive. An element with three
  // sentences in it is content whatever its class says, so the hint only wins
  // on something short — which is what a nav or a share bar is.
  return element.textContent!.trim().length < 400;
}

/* ── Main-content extraction ──────────────────────────────────────────── */

/**
 * Pick the element that looks most like an article.
 *
 * Semantic tags first, because a page that says `<article>` has already
 * answered the question. Failing that, a density score in the spirit of
 * Readability: paragraph text is worth a lot, link text is worth nothing, and a
 * container that is mostly links is a menu no matter how much text it holds.
 */
function pickMain(body: Element): Element {
  for (const selector of ['article', 'main', '[role="main"]', '#content', '.post-content']) {
    const found = body.querySelector(selector);
    if (found && found.textContent!.trim().length > 200) return found;
  }

  let best = body;
  let bestScore = score(body);

  for (const candidate of body.querySelectorAll('div, section, td')) {
    const value = score(candidate);
    if (value > bestScore) {
      best = candidate;
      bestScore = value;
    }
  }
  return best;
}

/** Text length outside links, penalised for link density and shallow structure. */
function score(element: Element): number {
  const text = element.textContent ?? '';
  if (text.trim().length < 140) return 0;

  let linkChars = 0;
  for (const anchor of element.querySelectorAll('a')) {
    linkChars += (anchor.textContent ?? '').length;
  }
  const density = linkChars / Math.max(1, text.length);
  if (density > 0.5) return 0;

  const paragraphs = element.querySelectorAll('p').length;
  const commas = (text.match(/[,，、]/g) ?? []).length;

  // Commas are the cheap prose signal Readability uses, and it holds up: menus
  // and card grids have almost none, and written sentences have many.
  return (text.length - linkChars) * (1 - density) + paragraphs * 60 + commas * 12;
}

function describe(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  const first = element.className.toString().trim().split(/\s+/)[0];
  return first ? `${tag}.${first}` : tag;
}

/* ── Serialisation ────────────────────────────────────────────────────── */

interface LinkRef {
  readonly href: string;
  readonly title: string;
}

interface State {
  readonly options: MarkdownOptions;
  readonly counters: {
    headings: number;
    links: number;
    images: number;
    codeBlocks: number;
    tables: number;
  };
  readonly unhandled: Set<string>;
  readonly links: LinkRef[];
  readonly linkIndex: Map<string, number>;
}

/** Tags whose contents pass straight through with no Markdown of their own. */
const TRANSPARENT = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'span',
  'font',
  'small',
  'body',
  'html',
  'figure',
  'figcaption',
  'colgroup',
  'col',
  'time',
  'data',
  'bdi',
  'bdo',
  'ruby',
  'center',
  'address',
]);

const BLOCK_LEVEL = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'pre',
  'blockquote',
  'table',
  'tr',
  'hr',
  'dl',
  'dt',
  'dd',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'figure',
  'details',
]);

function renderChildren(node: Node, state: State, indent: string): string {
  let out = '';
  for (const child of node.childNodes) out += render(child, state, indent);
  return out;
}

/**
 * Render one node.
 *
 * `indent` is threaded through rather than applied afterwards because a nested
 * list needs its continuation lines indented to the parent marker, and that is
 * only knowable on the way down.
 */
function render(node: Node, state: State, indent: string): string {
  if (node.nodeType === 3 /* TEXT_NODE */) return text(node);
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const { options, counters } = state;

  switch (tag) {
    /* ── Headings ──────────────────────────────────────────────── */
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1]);
      const body = inline(element, state).trim();
      if (body === '') return '';
      counters.headings += 1;
      if (options.headings === 'setext' && level <= 2) {
        const rule = (level === 1 ? '=' : '-').repeat(Math.max(3, Math.min(body.length, 80)));
        return `\n\n${body}\n${rule}\n\n`;
      }
      return `\n\n${'#'.repeat(level)} ${body}\n\n`;
    }

    /* ── Text blocks ───────────────────────────────────────────── */
    case 'p': {
      const body = wrapText(inline(element, state).trim(), options.wrap, indent);
      return body === '' ? '' : `\n\n${body}\n\n`;
    }

    case 'br':
      // Two trailing spaces is the portable hard break. A backslash break is
      // CommonMark-only and renders as a literal backslash on older engines.
      return `  \n${indent}`;

    case 'hr':
      return '\n\n---\n\n';

    /* ── Emphasis ──────────────────────────────────────────────── */
    case 'strong':
    case 'b':
      return wrapInline(element, state, '**');

    case 'em':
    case 'i':
    case 'cite':
    case 'var':
      return wrapInline(element, state, options.emphasis);

    case 'del':
    case 's':
    case 'strike':
      return wrapInline(element, state, '~~');

    case 'mark':
      // No Markdown for a highlight. `==text==` is a widespread extension and
      // degrades to visible punctuation rather than silently losing the emphasis.
      return wrapInline(element, state, '==');

    case 'sub':
    case 'sup':
      // Genuinely unrepresentable. HTML is kept, because Markdown passes it
      // through and the alternative is changing what a formula means.
      return `<${tag}>${inline(element, state)}</${tag}>`;

    /* ── Code ──────────────────────────────────────────────────── */
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt': {
      // Inside a <pre> the fence handles it; a nested backtick span would
      // double-wrap the whole block.
      if (element.closest('pre')) return element.textContent ?? '';
      return codeSpan(element.textContent ?? '');
    }

    case 'pre': {
      const raw = (element.textContent ?? '').replace(/\n+$/, '');
      if (raw.trim() === '') return '';
      counters.codeBlocks += 1;
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(raw) + 1));
      return `\n\n${fence}${languageOf(element)}\n${raw}\n${fence}\n\n`;
    }

    /* ── Lists ─────────────────────────────────────────────────── */
    case 'ul':
    case 'ol':
      return `\n\n${renderList(element, state, indent)}\n\n`;

    case 'li':
      // Reached only for an orphan <li> with no list parent. Rendered as a
      // bullet rather than dropped, because the content is real.
      return `\n${indent}${options.bullet} ${inline(element, state).trim()}`;

    /* ── Definition lists ──────────────────────────────────────── */
    case 'dl':
      return `\n\n${renderChildren(element, state, indent).trim()}\n\n`;

    case 'dt':
      return `\n\n**${inline(element, state).trim()}**\n`;

    case 'dd':
      return `\n${indent}: ${inline(element, state).trim()}\n`;

    /* ── Quotes ────────────────────────────────────────────────── */
    case 'blockquote': {
      const body = tidy(renderChildren(element, state, indent)).trim();
      if (body === '') return '';
      // Blank lines inside the quote need the marker too, or the quote breaks
      // in two at the first paragraph boundary.
      const quoted = body
        .split('\n')
        .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
        .join('\n');
      return `\n\n${quoted}\n\n`;
    }

    /* ── Links and media ───────────────────────────────────────── */
    case 'a': {
      const label = inline(element, state).trim();
      const href = (element.getAttribute('href') ?? '').trim();
      if (label === '') return '';
      // An anchor with no destination is not a link. Emitting `[text]()`
      // produces a dead link where the source had plain text.
      if (href === '' || href.startsWith('javascript:') || href === '#') return label;
      counters.links += 1;

      const title = (element.getAttribute('title') ?? '').trim();
      if (state.options.referenceLinks) {
        const key = `${href} ${title}`;
        let index = state.linkIndex.get(key);
        if (index === undefined) {
          state.links.push({ href, title });
          index = state.links.length;
          state.linkIndex.set(key, index);
        }
        return `[${label}][${index}]`;
      }
      return `[${label}](${encodeTarget(href)}${title ? ` "${title.replace(/"/g, '')}"` : ''})`;
    }

    case 'img': {
      const alt = (element.getAttribute('alt') ?? '').trim();
      if (state.options.images === 'drop') return '';
      if (state.options.images === 'alt-only') return alt;
      // Lazy-loaded images keep the real URL in data-src and a placeholder in
      // src. Reading src first would collect a page of identical 1px GIFs.
      const src = (
        element.getAttribute('data-src') ||
        element.getAttribute('src') ||
        element.getAttribute('data-original') ||
        ''
      ).trim();
      if (src === '') return alt;
      counters.images += 1;
      const title = (element.getAttribute('title') ?? '').trim();
      return `![${alt}](${encodeTarget(src)}${title ? ` "${title.replace(/"/g, '')}"` : ''})`;
    }

    /* ── Tables ────────────────────────────────────────────────── */
    case 'table':
      return renderTable(element, state);

    /* ── Collapsible ───────────────────────────────────────────── */
    case 'details': {
      const summary = element.querySelector('summary');
      const label = summary ? inline(summary, state).trim() : 'Details';
      summary?.remove();
      const body = tidy(renderChildren(element, state, indent)).trim();
      // HTML, because Markdown has no collapsible block and flattening one
      // loses the fact that the content was hidden by default.
      return `\n\n<details>\n<summary>${label}</summary>\n\n${body}\n\n</details>\n\n`;
    }

    default:
      if (TRANSPARENT.has(tag)) return renderChildren(element, state, indent);
      state.unhandled.add(tag);
      return renderChildren(element, state, indent);
  }
}

/* ── Inline helpers ───────────────────────────────────────────────────── */

/** Render children and flatten to a single line, for a context that needs one. */
function inline(element: Element, state: State): string {
  return renderChildren(element, state, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

function wrapInline(element: Element, state: State, marker: string): string {
  const body = inline(element, state);
  const trimmed = body.trim();
  if (trimmed === '') return body;
  // Whitespace is moved outside the markers. `** bold **` is not bold in any
  // renderer, and inline elements very often carry a leading space.
  const before = body.startsWith(' ') || body.startsWith('\t') ? ' ' : '';
  const after = body.endsWith(' ') || body.endsWith('\t') ? ' ' : '';
  return `${before}${marker}${trimmed}${marker}${after}`;
}

/**
 * Wrap inline code, choosing a fence longer than any run inside it.
 *
 * A literal backtick in code is common (shell, Markdown about Markdown) and the
 * single-backtick form silently truncates at it.
 */
function codeSpan(raw: string): string {
  const body = raw.replace(/\s+/g, ' ');
  if (body === '') return '';
  const fence = '`'.repeat(longestBacktickRun(body) + 1);
  // A pad is required when the content starts or ends with a backtick, which is
  // how CommonMark disambiguates the fence from the content.
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/** Read the language off a highlighter's class, whichever convention it used. */
function languageOf(pre: Element): string {
  const source = `${pre.className} ${pre.querySelector('code')?.className ?? ''}`;
  const match = /(?:language|lang|highlight|brush)[-:]([A-Za-z0-9+#]+)/.exec(source);
  const language = match?.[1]?.toLowerCase() ?? '';
  return language === 'none' || language === 'text' ? '' : language;
}

/**
 * Percent-encode the characters that would break link syntax.
 *
 * Spaces and brackets are the two that actually occur, and the angle-bracket
 * form (`<url with spaces>`) is not supported everywhere. Anything already
 * encoded is left alone, so `%20` does not become `%2520`.
 */
function encodeTarget(href: string): string {
  return href.replace(/[ ()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/* ── Text ─────────────────────────────────────────────────────────────── */

/**
 * Characters that start a Markdown construct and so need escaping in prose.
 *
 * Only at a position where they *would* be a construct: escaping every `-` and
 * `.` turns readable prose into a thicket of backslashes, which is the failure
 * mode of every over-eager converter.
 */
function escapeText(raw: string): string {
  return (
    raw
      .replace(/([\\`*_[\]<>])/g, '\\$1')
      // A run of digits then a dot at the start of a line is an ordered list item.
      .replace(/^(\s*)(\d+)\.(\s)/gm, '$1$2\\.$3')
      // A leading -, +, #, or > is a block construct.
      .replace(/^(\s*)([-+#>])(\s)/gm, '$1\\$2$3')
      // A run of = or - alone on a line is a Setext heading for the line above.
      .replace(/^(\s*)([=-]{2,})(\s*)$/gm, '$1\\$2$3')
  );
}

function text(node: Node): string {
  const raw = node.nodeValue ?? '';

  // Inside a <pre> whitespace is content, and escaping would corrupt the code.
  if ((node.parentElement?.closest('pre, code') ?? null) !== null) return raw;

  // HTML collapses runs of whitespace, so the converter must too, or every
  // indented source file becomes a paragraph full of gaps.
  const collapsed = raw.replace(/[\t\n\r ]+/g, ' ');
  if (collapsed.trim() === '') {
    // A space between two inline elements is meaningful; one between two blocks
    // is formatting. Dropping it in the block case is what keeps stray blank
    // lines out of the output.
    return isBetweenBlocks(node) ? '' : collapsed === '' ? '' : ' ';
  }
  return escapeText(collapsed);
}

function isBetweenBlocks(node: Node): boolean {
  const isBlock = (sibling: Node | null): boolean =>
    sibling === null ||
    (sibling.nodeType === 1 && BLOCK_LEVEL.has((sibling as Element).tagName.toLowerCase()));
  return isBlock(node.previousSibling) && isBlock(node.nextSibling);
}

/* ── Lists ────────────────────────────────────────────────────────────── */

function renderList(list: Element, state: State, indent: string): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const start = Number(list.getAttribute('start') ?? '1') || 1;
  const items = [...list.children].filter((child) => child.tagName.toLowerCase() === 'li');
  const lines: string[] = [];

  items.forEach((item, i) => {
    const marker = ordered ? `${start + i}.` : state.options.bullet;
    // Continuation lines align under the text, not the marker, which is what
    // makes a nested list nest instead of starting a new one.
    const childIndent = `${indent}${' '.repeat(marker.length + 1)}`;

    const task = taskMarker(item);
    const prefix = `${indent}${marker} ${task}`;

    const body = tidy(renderChildren(item, state, childIndent)).trim();
    if (body === '' && task === '') return;

    const [first, ...rest] = body.split('\n');
    lines.push(`${prefix}${first ?? ''}`);
    for (const line of rest) {
      lines.push(
        line.trim() === '' ? '' : line.startsWith(childIndent) ? line : `${childIndent}${line}`,
      );
    }
  });

  return lines.join('\n');
}

/** A checkbox as the first child means a task list. */
function taskMarker(item: Element): string {
  const box = item.querySelector(
    ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
  );
  if (!box) return '';
  return box.hasAttribute('checked') ? '[x] ' : '[ ] ';
}

/* ── Tables ───────────────────────────────────────────────────────────── */

/**
 * Render a table as a GitHub pipe table, or as a list where it cannot be one.
 *
 * The fallback matters. A pipe table cannot express a merged cell or a nested
 * block, and emitting one anyway produces a table that renders with the columns
 * silently shifted. A definition list per row loses the grid but keeps every
 * value attached to the right heading.
 */
function renderTable(table: Element, state: State): string {
  const rows = [...table.querySelectorAll('tr')];
  if (rows.length === 0) return '';

  const spans = rows.some((row) =>
    [...row.children].some(
      (cell) =>
        Number(cell.getAttribute('colspan') ?? '1') > 1 ||
        Number(cell.getAttribute('rowspan') ?? '1') > 1,
    ),
  );
  const blocks = table.querySelector('td > p + p, td > ul, td > ol, td > pre, td > table') !== null;

  if (!state.options.tables || spans || blocks) {
    return renderTableAsList(rows, state, spans || blocks);
  }

  const grid = rows.map((row) =>
    [...row.children].map((cell) => inline(cell, state).trim().replace(/\|/g, '\\|')),
  );
  const width = Math.max(...grid.map((row) => row.length));
  if (width === 0) return '';

  const firstRow = rows[0];
  const hasHeader = firstRow ? firstRow.querySelector('th') !== null : false;
  const header = hasHeader
    ? (grid[0] ?? [])
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const bodyRows = hasHeader ? grid.slice(1) : grid;

  const pad = (row: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;

  state.counters.tables += 1;
  const alignments = columnAlignments(firstRow, width);
  return [
    '',
    '',
    pad(header),
    `|${alignments.map((a) => (a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':--:' : '---')).join('|')}|`,
    ...bodyRows.map(pad),
    '',
    '',
  ].join('\n');
}

/** Read per-column alignment off the header row's style or align attribute. */
function columnAlignments(
  headerRow: Element | undefined,
  width: number,
): ReadonlyArray<'left' | 'right' | 'center' | 'none'> {
  const cells = headerRow ? [...headerRow.children] : [];
  return Array.from({ length: width }, (_, i) => {
    const cell = cells[i];
    if (!cell) return 'none';
    const source =
      `${cell.getAttribute('align') ?? ''} ${cell.getAttribute('style') ?? ''}`.toLowerCase();
    if (source.includes('right')) return 'right';
    if (source.includes('center')) return 'center';
    if (source.includes('left')) return 'left';
    return 'none';
  });
}

function renderTableAsList(rows: readonly Element[], state: State, degraded: boolean): string {
  const firstRow = rows[0];
  const headers = firstRow ? [...firstRow.children].map((cell) => inline(cell, state).trim()) : [];
  const hasHeader = firstRow?.querySelector('th') !== null;
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  const note = degraded
    ? '<!-- table had merged cells or block content: rendered as a list, since a pipe table cannot express either -->\n'
    : '';

  const blocks = bodyRows.map((row, index) => {
    const cells = [...row.children];
    const lines = cells.map((cell, i) => {
      const label = hasHeader ? (headers[i] ?? `Column ${i + 1}`) : `Column ${i + 1}`;
      return `${state.options.bullet} **${label}**: ${inline(cell, state).trim()}`;
    });
    return `**Row ${index + 1}**\n\n${lines.join('\n')}`;
  });

  return `\n\n${note}${blocks.join('\n\n')}\n\n`;
}

/* ── Whitespace ───────────────────────────────────────────────────────── */

/**
 * Collapse the blank-line noise that block rendering necessarily produces.
 *
 * Every block emits its own leading and trailing blank lines, which is what
 * makes them composable at any nesting depth and guarantees runs of three or
 * more. Normalising once at the end is far simpler than making every branch
 * aware of its neighbours.
 */
function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
    .trimEnd();
}

/**
 * Greedy wrap at `width`, leaving Markdown constructs alone.
 *
 * Off by default. Hard-wrapped Markdown produces a diff per reflow, which is
 * exactly the problem the text-diff tool on this site exists to work around.
 */
function wrapText(text: string, width: number, indent: string): string {
  if (width <= 0 || text.length <= width) return text;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines.join(`\n${indent}`);
}
