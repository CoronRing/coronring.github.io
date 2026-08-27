/**
 * A small code editor: gutter, highlighting, and the keys that matter.
 *
 * ## Why not CodeMirror
 *
 * CodeMirror 6 is the right answer for an IDE and the wrong one for this. It is
 * around 250 kB of JavaScript to type Python into a box on a page whose entire
 * design argument is that it loads fast. What a runnable sample actually needs is
 * a gutter, colour, an indent-aware Tab and Enter, and a run shortcut. That is
 * this file, at a fraction of the weight, with no dependency to keep current.
 *
 * ## How it renders
 *
 * A transparent `<textarea>` sits exactly on top of a highlighted `<pre>`. The
 * browser handles selection, IME, undo, spell-check suppression and accessibility
 * for free; the `<pre>` handles colour. The two must agree on metrics to the
 * pixel, so font, size, line height, padding and tab size are declared once in
 * `SHARED` and applied to both. Getting that wrong is the classic version of this
 * bug: the caret drifts a little further from the text on every line.
 *
 * The pair scroll together, driven by the textarea, which is the element the
 * user is actually scrolling.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { tokenizePython, type TokenKind } from '../../lib/py-runtime';

/**
 * Metrics both layers must share.
 *
 * One declaration, two consumers. If the caret and the coloured text disagree,
 * the cause is a property here that only one of them got.
 */
const SHARED =
  'font-mono text-[12.5px] leading-[1.65] p-3.5 whitespace-pre [tab-size:4] [font-variant-ligatures:none]';

/**
 * Token colours.
 *
 * Two hues and the ink, not a rainbow. The palette on this site is monochrome
 * plus one accent, and a code block that introduces six new colours reads as
 * something pasted in from another product. Structure carries the weight:
 * comments recede, strings and numbers take the accent, keywords get the full
 * ink strength, and everything else is body text.
 */
const TOKEN_STYLE: Record<TokenKind, string> = {
  keyword: 'text-[var(--c-text)] font-semibold',
  builtin: 'text-[var(--c-text-muted)]',
  string: 'text-[var(--c-accent)]',
  comment: 'text-[var(--c-text-faint)] italic',
  number: 'text-[var(--c-accent)]',
  decorator: 'text-[var(--c-text-muted)] font-semibold',
  def: 'text-[var(--c-text)] font-semibold underline decoration-[var(--c-accent)] decoration-1 underline-offset-[3px]',
  operator: 'text-[var(--c-text-faint)]',
  plain: 'text-[var(--c-text)]',
};

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Ctrl/Cmd + Enter. */
  onRun?: () => void;
  /** Visible rows. The editor grows past this by scrolling, not by reflowing the page. */
  rows?: number;
  readOnly?: boolean;
  /** 1-based line to mark in the gutter, from a traceback. */
  errorLine?: number;
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  onChange,
  onRun,
  rows = 18,
  readOnly = false,
  errorLine,
  ariaLabel = 'Python source',
}: CodeEditorProps): React.ReactElement {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const tokens = useMemo(() => tokenizePython(value), [value]);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  /* ── Scroll sync ────────────────────────────────────────────────── */

  const syncScroll = useCallback(() => {
    const source = textarea.current;
    if (!source) return;
    if (highlight.current) {
      highlight.current.scrollTop = source.scrollTop;
      highlight.current.scrollLeft = source.scrollLeft;
    }
    setScrollTop(source.scrollTop);
  }, []);

  // Layout effect rather than effect: the highlighted layer must be positioned
  // before the browser paints, or a programmatic value change flashes the old
  // scroll position for a frame.
  useLayoutEffect(syncScroll, [value, syncScroll]);

  /* ── Keys ───────────────────────────────────────────────────────── */

  /**
   * Replace the selection and restore the caret.
   *
   * Written through `setRangeText` so the browser's own undo stack records it.
   * The obvious alternative, building a new string and calling `onChange`, works
   * and destroys undo: every Tab becomes an unrepeatable state change, which is
   * infuriating in an editor.
   */
  const replaceSelection = useCallback(
    (text: string, selectStart: number, selectEnd: number) => {
      const element = textarea.current;
      if (!element) return;
      element.setRangeText(text, element.selectionStart, element.selectionEnd, 'end');
      element.setSelectionRange(selectStart, selectEnd);
      onChange(element.value);
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const element = event.currentTarget;
      const { selectionStart, selectionEnd } = element;

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        onRun?.();
        return;
      }

      if (readOnly) return;

      if (event.key === 'Tab') {
        event.preventDefault();
        const lineStart = element.value.lastIndexOf('\n', selectionStart - 1) + 1;

        // A selection spanning lines indents or outdents the block, which is
        // what Tab means in every editor and is the operation Python needs most.
        if (
          selectionStart !== selectionEnd &&
          element.value.slice(selectionStart, selectionEnd).includes('\n')
        ) {
          const lineEnd = element.value.indexOf('\n', selectionEnd);
          const end = lineEnd === -1 ? element.value.length : lineEnd;
          const block = element.value.slice(lineStart, end);
          const shifted = event.shiftKey
            ? block.replace(/^ {1,4}/gm, '')
            : block.replace(/^/gm, '    ');
          element.setRangeText(shifted, lineStart, end, 'select');
          onChange(element.value);
          return;
        }

        if (event.shiftKey) {
          const before = element.value.slice(lineStart, selectionStart);
          const trimmed = before.replace(/ {1,4}$/, '');
          if (trimmed !== before) {
            element.setRangeText(trimmed, lineStart, selectionStart, 'end');
            onChange(element.value);
          }
          return;
        }

        // Tab to the next multiple of four rather than inserting four spaces, so
        // pressing it on a partly-indented line lands on a stop.
        const column = selectionStart - lineStart;
        const width = 4 - (column % 4);
        replaceSelection(' '.repeat(width), selectionStart + width, selectionStart + width);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const lineStart = element.value.lastIndexOf('\n', selectionStart - 1) + 1;
        const line = element.value.slice(lineStart, selectionStart);
        const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
        // A line ending in a colon opens a block, so the next line indents. This
        // is the single most useful thing an editor can do for Python.
        const opensBlock = /:\s*(#.*)?$/.test(line);
        const insert = `\n${indent}${opensBlock ? '    ' : ''}`;
        replaceSelection(insert, selectionStart + insert.length, selectionStart + insert.length);
        return;
      }

      // Wrap a selection in the bracket or quote rather than replacing it, which
      // is what every editor does and what muscle memory expects.
      const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
      const closing = pairs[event.key];
      if (closing !== undefined && selectionStart !== selectionEnd) {
        event.preventDefault();
        const selected = element.value.slice(selectionStart, selectionEnd);
        replaceSelection(`${event.key}${selected}${closing}`, selectionStart + 1, selectionEnd + 1);
      }
    },
    [onChange, onRun, readOnly, replaceSelection],
  );

  /* ── Render ─────────────────────────────────────────────────────── */

  const lineHeight = 12.5 * 1.65;

  return (
    <div className="relative overflow-hidden bg-[var(--c-sunken)]">
      <div className="flex">
        {/* Gutter. Translated rather than scrolled, so it cannot lag by a frame. */}
        <div
          ref={gutter}
          aria-hidden="true"
          className="relative shrink-0 overflow-hidden border-r border-[var(--c-line)] bg-[var(--c-raised)] select-none"
          style={{
            width: `${String(lineCount).length + 2}ch`,
            height: `${rows * lineHeight + 28}px`,
          }}
        >
          <div
            className={`${SHARED} text-right text-[var(--c-text-faint)]`}
            style={{
              transform: `translateY(${-scrollTop}px)`,
              paddingLeft: 0,
              paddingRight: '0.5rem',
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div
                key={i}
                className={errorLine === i + 1 ? 'font-semibold text-[var(--c-alert)]' : undefined}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        <div className="relative min-w-0 flex-1" style={{ height: `${rows * lineHeight + 28}px` }}>
          <pre
            ref={highlight}
            aria-hidden="true"
            className={`${SHARED} pointer-events-none absolute inset-0 m-0 overflow-hidden`}
          >
            {tokens.map((token, i) => (
              <span key={i} className={TOKEN_STYLE[token.kind]}>
                {token.text}
              </span>
            ))}
            {/* A trailing newline collapses in a <pre>, which shifts the last
                line of colour off the caret. A zero-width space holds it open. */}
            {'​'}
          </pre>

          <textarea
            ref={textarea}
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={ariaLabel}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onScroll={syncScroll}
            className={`${SHARED} absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent text-transparent caret-[var(--c-accent)] selection:bg-[var(--c-accent-soft)] focus:outline-none`}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Pull the failing line number out of a Python traceback.
 *
 * Reads the *last* `File "<exec>", line N` frame rather than the first: the
 * first frame is Pyodide's own wrapper, and the last one inside user code is
 * where the visitor should look. Returns undefined when the traceback names no
 * line, which happens on a `SyntaxError` reported without one.
 */
export function errorLineFrom(traceback: string): number | undefined {
  const matches = [...traceback.matchAll(/File "(?:<exec>|<string>|<unknown>)", line (\d+)/g)];
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : undefined;
}
