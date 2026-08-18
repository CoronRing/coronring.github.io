import type { ReactElement, ReactNode } from 'react';

/**
 * A deliberately small Markdown renderer for assistant answers.
 *
 * Scope is exactly what the assistant is instructed to emit: paragraphs, lists,
 * links, bold, and inline code. Anything else renders as its own literal text,
 * which is the right failure mode — a stray `#` shows up as a `#` rather than
 * silently restructuring the answer.
 *
 * It builds React elements and never touches `dangerouslySetInnerHTML`. That is
 * the whole security argument: this text is model output shaped partly by
 * visitor input, so treating it as data rather than markup means an injected
 * `<img onerror=...>` is displayed, not executed. Pulling in `marked` or
 * `react-markdown` would mean auditing a sanitiser instead.
 *
 * Links are constrained to root-relative routes. The backend already drops any
 * citation that is not a real page, and this is the second half of that rule:
 * an answer cannot render a clickable link to somewhere off-site even if one
 * survives.
 */

/** `[text](/route)` — root-relative only, and never protocol-relative. */
const LINK = /\[([^\]]+)\]\((\/(?!\/)[A-Za-z0-9._~\-/]*)\)/g;
/** `**bold**` */
const BOLD = /\*\*([^*]+)\*\*/g;
/** `` `code` `` */
const CODE = /`([^`]+)`/g;
/**
 * A bare `[/route]`, with no label.
 *
 * Not the instructed citation format, but the one models fall back to under
 * pressure — `gemini-3.6-flash` produced it in production. Rendering it as a
 * link beats showing the reader a stray `[/resume]` in the middle of a
 * sentence. Must come last in the combined pattern so a real `[label](/route)`
 * is matched by `LINK` first.
 */
const BARE_LINK = /\[(\/(?!\/)[A-Za-z0-9._~\-/]*)\](?!\()/g;

/**
 * Render the inline span syntax within one line of text.
 *
 * Handled in one pass over a combined pattern rather than by chaining three
 * replaces, so a link's label cannot be re-scanned and mangled by a later rule.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = new RegExp(
    `${LINK.source}|${BOLD.source}|${CODE.source}|${BARE_LINK.source}`,
    'g',
  );
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;

    const [, linkLabel, linkHref, boldText, codeText, bareHref] = match;
    if (bareHref !== undefined) {
      out.push(
        <a
          key={key}
          href={bareHref}
          className="text-accent underline decoration-[var(--c-accent-ring)] underline-offset-2 transition-colors hover:decoration-[var(--c-accent)]"
        >
          {bareHref}
        </a>,
      );
    } else if (linkHref !== undefined) {
      out.push(
        <a
          key={key}
          href={linkHref}
          className="text-accent underline decoration-[var(--c-accent-ring)] underline-offset-2 transition-colors hover:decoration-[var(--c-accent)]"
        >
          {linkLabel}
        </a>,
      );
    } else if (boldText !== undefined) {
      out.push(
        <strong key={key} className="text-fg font-semibold">
          {boldText}
        </strong>,
      );
    } else if (codeText !== undefined) {
      out.push(
        <code
          key={key}
          className="bg-raised border-line rounded-[2px] border px-1 py-px font-mono text-[0.85em]"
        >
          {codeText}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Render an assistant answer.
 *
 * @param text Markdown-ish answer text. Partial text is fine — this is called
 *   on every streamed chunk, so it must render a half-finished document without
 *   complaint.
 */
export default function Markdown({ text }: { text: string }): ReactElement {
  const blocks: ReactElement[] = [];
  const lines = text.split('\n');

  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className="leading-relaxed">
        {inline(paragraph.join(' '), key)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = (): void => {
    if (!list.length) return;
    const key = `ul-${blocks.length}`;
    blocks.push(
      <ul key={key} className="list-disc space-y-1 pl-5 leading-relaxed">
        {list.map((item, i) => (
          <li key={`${key}-${i}`}>{inline(item, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);

    if (bullet) {
      flushParagraph();
      list.push(bullet[1] ?? '');
      continue;
    }

    flushList();

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (heading) {
      flushParagraph();
      const key = `h-${blocks.length}`;
      blocks.push(
        <p key={key} className="text-fg font-semibold">
          {inline(heading[1] ?? '', key)}
        </p>,
      );
      continue;
    }

    paragraph.push(line.trim());
  }

  flushList();
  flushParagraph();

  return <div className="space-y-3">{blocks}</div>;
}
