import { useEffect, useRef, useState, type ReactElement } from 'react';

import Conversation from './Conversation';
import { useChat } from './useChat';

/**
 * ChatDock — the corner module. Present on every page, collapsed by default.
 *
 * Collapsed it is a single button; it costs no network until opened, because
 * `useChat` only probes when told it is active. That matters on a site whose
 * whole point is that it loads fast: an always-on assistant that pings a
 * free-tier backend on every page view would be paying for a feature most
 * visitors never touch.
 *
 * Deliberately not rendered on `/chat` — the full page is the same assistant,
 * and a floating duplicate of it in the corner is just clutter. The host
 * element decides that, not this component.
 */

/** Matches the site's own breakpoint for the fixed rail. */
const DESKTOP = '(min-width: 64rem)';

export default function ChatDock(): ReactElement {
  const [open, setOpen] = useState(false);
  const chat = useChat(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus returns to the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

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
            className="panel corner-ticks pointer-events-auto absolute inset-x-3 bottom-3 flex h-[min(70dvh,32rem)] flex-col shadow-[var(--shadow-lift)] sm:inset-x-auto sm:right-5 sm:bottom-20 sm:w-[24rem]"
          >
            <div className="border-line flex shrink-0 items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <p className="eyebrow eyebrow-marked">Site assistant</p>
                <p className="text-faint mt-1 truncate font-mono text-[10px]">
                  Answers from this site&rsquo;s pages
                </p>
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
                  onClick={() => {
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
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
            aria-label="Ask about this site"
            className="panel corner-ticks text-fg hover:border-accent pointer-events-auto absolute right-4 bottom-4 flex items-center gap-2 px-3.5 py-2.5 shadow-[var(--shadow-panel)] transition-colors sm:right-5 sm:bottom-5"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="text-accent size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.6 8.2Z" />
            </svg>
            <span className="font-mono text-[11px] tracking-wide uppercase">Ask</span>
          </button>
        )}
      </div>
    </>
  );
}
