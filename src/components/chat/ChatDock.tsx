import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import Conversation from './Conversation';
import Crown from './Crown';
import { DEFAULT_MOOD, moodFor, MOODS, type Mood } from './mood';
import { useChat } from './useChat';

/**
 * ChatDock — CoronChat. Present on every page, collapsed by default.
 *
 * Collapsed it is a single button; it costs no network until opened, because
 * `useChat` only probes when told it is active. That matters on a site whose
 * whole point is that it loads fast: an always-on assistant that pings a
 * free-tier backend on every page view would be paying for a feature most
 * visitors never touch.
 *
 * ## The nudge
 *
 * Nobody clicks a button labelled "Ask". So once a visitor has been on the
 * page long enough to have read something, the dock opens itself once and puts
 * a real question on screen — not "how can I help", an actual question about
 * this site that they can send with one click.
 *
 * Three rules keep that from being the thing everyone hates:
 *
 *  1. **Once a session.** A `sessionStorage` flag, set the moment it fires, so
 *     it does not reappear on the next page of an MPA.
 *  2. **It leaves on its own.** Fifteen seconds with no interaction and it
 *     collapses again. Only when it opened itself — a panel the visitor opened
 *     stays open until they close it.
 *  3. **Never over the real thing.** The home page carries the same assistant
 *     as a section; while that is on screen the dock hides entirely rather
 *     than floating a second copy of itself over the first.
 *
 * `prefers-reduced-motion` suppresses the nudge altogether: an interface that
 * moves on its own is exactly what that setting is asking us not to do.
 *
 * ## Why it is not a support bubble
 *
 * A round icon in the corner reads as "contact us", and nobody presses it. This
 * one carries the site's own mark, its own name, and a line saying what it is
 * currently looking at — which changes as the visitor scrolls, because the
 * assistant answers from the pages and therefore knows which one is on screen.
 * Its offered question changes with it, so pressing it at the tools band asks
 * about tools. That is the difference between a widget and a guide, and it is
 * the half of this site that is about the work rather than a record of it.
 *
 * Deliberately not rendered on `/chat` — the full page is the same assistant,
 * and a floating duplicate of it in the corner is just clutter. The host
 * element decides that, not this component.
 */

/** Matches the site's own breakpoint for the fixed rail. */
const DESKTOP = '(min-width: 64rem)';

/** Long enough to have read something, short enough to still be here. */
const NUDGE_AFTER_MS = 14_000;
/** How long an unattended nudge stays up before it withdraws. */
const NUDGE_WITHDRAW_MS = 15_000;
const NUDGE_KEY = 'coronring:asked';

/**
 * Which band the visitor is reading, from the same ids the rail scroll-spies.
 *
 * One observer over all of them rather than a scroll handler doing arithmetic:
 * the section nearest the middle of the viewport wins, so a short band between
 * two long ones still gets its turn.
 */
function useMood(): Mood {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;

    const sections = MOODS.map((m) => document.getElementById(m.id ?? '')).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.intersectionRatio);
        let best: string | null = null;
        let bestRatio = 0;
        for (const [key, ratio] of seen) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = key;
          }
        }
        setId(bestRatio > 0.08 ? best : null);
      },
      { threshold: [0, 0.08, 0.25, 0.5, 0.75, 1] },
    );

    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return moodFor(id);
}

export default function ChatDock(): ReactElement {
  const [open, setOpen] = useState(false);
  /** True only for a panel the dock opened by itself. */
  const [nudged, setNudged] = useState(false);
  /** Hidden while the page's own assistant section is on screen. */
  const [eclipsed, setEclipsed] = useState(false);
  const chat = useChat(open);
  const mood = useMood();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /*
   * The band's own question comes first. The backend's suggestions are about
   * the site as a whole; the one thing the dock knows that the backend does not
   * is where on the page the visitor currently is.
   */
  const question = mood.id ? mood.question : (chat.suggestions[0] ?? DEFAULT_MOOD.question);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    setNudged(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  // Escape closes, and focus returns to the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // On a phone the panel covers the page, so the body must not scroll behind it.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia(DESKTOP).matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /*
   * Stand down while the page's own `#ask` band is visible. Two assistants on
   * screen at once is a bug however you got there, and the one in the page is
   * the better of the two.
   */
  useEffect(() => {
    const section = document.getElementById('ask');
    if (!section || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([entry]) => setEclipsed(entry?.isIntersecting ?? false), {
      rootMargin: '-10% 0px -10% 0px',
    });
    io.observe(section);
    return () => io.disconnect();
  }, []);

  // ── The nudge: open once, unprompted ──────────────────────────────
  useEffect(() => {
    if (open || eclipsed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      if (sessionStorage.getItem(NUDGE_KEY) === '1') return;
    } catch {
      // Private mode and similar: no flag means no nudge, which is the safe way round.
      return;
    }

    const id = window.setTimeout(() => {
      try {
        sessionStorage.setItem(NUDGE_KEY, '1');
      } catch {
        /* Nothing to do; the nudge is a nicety, not a feature. */
      }
      setOpen(true);
      setNudged(true);
    }, NUDGE_AFTER_MS);

    return () => window.clearTimeout(id);
  }, [open, eclipsed]);

  // ── …and withdraw if it is ignored ────────────────────────────────
  useEffect(() => {
    if (!nudged || !open) return;
    const panel = panelRef.current;
    if (!panel) return;

    let id = window.setTimeout(() => close(false), NUDGE_WITHDRAW_MS);
    // Any sign of interest and the panel is the visitor's, not ours.
    const keep = (): void => {
      window.clearTimeout(id);
      id = 0;
      setNudged(false);
    };
    for (const type of ['pointerdown', 'keydown', 'focusin'] as const) {
      panel.addEventListener(type, keep);
    }
    return () => {
      if (id) window.clearTimeout(id);
      for (const type of ['pointerdown', 'keydown', 'focusin'] as const) {
        panel.removeEventListener(type, keep);
      }
    };
  }, [nudged, open, close]);

  // Sending anything, however it started, ends the nudge.
  useEffect(() => {
    if (chat.messages.length > 0) setNudged(false);
  }, [chat.messages.length]);

  if (eclipsed && !open) {
    return <div data-corpus-skip hidden />;
  }

  return (
    <>
      {/*
        `data-corpus-skip` keeps this out of the build-time corpus. Without it
        the assistant would read its own UI as site content and start answering
        questions about the "Ask" button.
      */}
      <div data-corpus-skip className="pointer-events-none fixed inset-0 z-50">
        {open && (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label="Site assistant"
            className={`panel corner-ticks pointer-events-auto absolute inset-x-3 bottom-3 flex h-[min(70dvh,32rem)] flex-col shadow-[var(--shadow-lift)] sm:inset-x-auto sm:right-5 sm:bottom-20 sm:w-[24rem] ${
              nudged ? 'ask-panel-nudge' : ''
            }`}
          >
            <div className="border-line flex shrink-0 items-center justify-between border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Crown energy={1} className="text-accent size-5 shrink-0" />
                <div className="min-w-0">
                  <p className="eyebrow eyebrow-marked">CoronChat</p>
                  <p className="text-faint mt-1 truncate font-mono text-[10px]">{mood.line}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href="/chat"
                  aria-label="Open the full chat page"
                  className="text-faint hover:text-accent rounded-[2px] p-1.5 transition-colors"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                    <path d="M21 14v7H3V3h7" />
                  </svg>
                </a>
                <button
                  type="button"
                  onClick={() => close(true)}
                  aria-label="Close the assistant"
                  className="text-faint hover:text-accent rounded-[2px] p-1.5 transition-colors"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/*
              The nudge's whole payload: one real question, already written, one
              click from being asked. It is a button rather than a line of copy
              because a suggestion you cannot act on is just more text.
            */}
            {nudged && chat.messages.length === 0 && (
              <button
                type="button"
                onClick={() => {
                  setNudged(false);
                  chat.send(question);
                }}
                className="ask-nudge border-line group shrink-0 border-b px-4 py-3 text-left"
              >
                <span className="eyebrow eyebrow-marked">Try asking</span>
                <span className="ask-nudge-q text-fg mt-1.5 block text-sm font-semibold">
                  {question}
                </span>
              </button>
            )}

            <div className="min-h-0 flex-1 px-0">
              <Conversation chat={chat} density="compact" placeholder="Ask about this site…" />
            </div>
          </div>
        )}

        {!open && (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Open CoronChat — ${mood.line}`}
            className="ask-hail panel corner-ticks text-fg pointer-events-auto absolute right-4 bottom-4 flex items-center gap-3 px-4 py-3 text-left shadow-[var(--shadow-lift)] sm:right-5 sm:bottom-5 sm:gap-3.5 sm:px-5 sm:py-3.5"
          >
            <span aria-hidden="true" className="ask-hail-mark">
              <Crown energy={mood.energy} className="size-7 sm:size-8" />
            </span>
            <span className="min-w-0">
              <span className="text-fg block text-sm font-semibold tracking-tight sm:text-[15px]">
                CoronChat
              </span>
              {/*
                Keyed on the band, so the line is replaced rather than edited.
                It is the one part of the button that says the assistant is
                paying attention.
              */}
              <span
                key={mood.id ?? 'default'}
                className="ask-hail-line text-muted mt-0.5 block font-mono text-[10px] tracking-[0.1em] whitespace-nowrap uppercase"
              >
                {mood.line}
              </span>
            </span>
          </button>
        )}
      </div>
    </>
  );
}
