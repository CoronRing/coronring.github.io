import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { ChatMessage } from '../../lib/site-chat-api';
import Markdown from './Markdown';
import type { UseChat } from './useChat';

/**
 * The transcript and composer — everything both chat surfaces have in common.
 *
 * The dock and the full page wrap this in different chrome and pass a different
 * `density`; nothing about the conversation itself differs between them, so
 * nothing about it is duplicated.
 */

export interface ConversationProps {
  chat: UseChat;
  /** `compact` for the corner dock, `full` for the dedicated page. */
  density?: 'compact' | 'full';
  /** Placeholder for the input. */
  placeholder?: string;
}

/** One turn. */
function Turn({ message }: { message: ChatMessage }): ReactElement {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="bg-raised border-line text-fg max-w-[85%] rounded-[var(--r-md)] border px-3.5 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  const pending = !message.content && !message.error;

  return (
    <div className="space-y-2">
      <div
        className={`text-sm ${message.error ? 'text-[var(--c-alert)]' : 'text-muted'}`}
      >
        {pending ? <Thinking /> : <Markdown text={message.content} />}
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="eyebrow !text-[10px]">Sources</span>
          {message.citations.map((citation) => (
            <a
              key={citation.route}
              href={citation.route}
              className="border-line text-muted hover:border-accent hover:text-accent rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] transition-colors"
            >
              {citation.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Three dots, while the first token is still in flight. */
function Thinking(): ReactElement {
  return (
    <span className="text-faint inline-flex items-center gap-1" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-[var(--c-text-faint)] inline-block size-1.5 rounded-full"
          style={{
            animation: 'chat-pulse 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}

export default function Conversation({
  chat,
  density = 'full',
  placeholder = 'Ask about the work, the stack, the experience…',
}: ConversationProps): ReactElement {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Whether to keep pinning the transcript to the bottom.
   *
   * Auto-scrolling unconditionally would drag the view away from a visitor who
   * has scrolled up to re-read an earlier answer while a new one streams in.
   */
  const [pinned, setPinned] = useState(true);

  const { messages, busy, send, reset, stop, suggestions, reachable, status } = chat;

  useEffect(() => {
    if (!pinned) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pinned]);

  const onScroll = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinned(distance < 48);
  };

  const submit = (): void => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setPinned(true);
    send(text);
    // Return focus so a follow-up can be typed without reaching for the mouse.
    inputRef.current?.focus();
  };

  const offline = !reachable;
  const notReady = status !== null && !status.ready;
  const disabled = busy || offline || notReady;
  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Transcript */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={`min-h-0 flex-1 overflow-y-auto ${density === 'compact' ? 'space-y-4 p-4' : 'space-y-6 py-2'}`}
      >
        {empty ? (
          <div className="space-y-4">
            <p className="text-muted text-sm leading-relaxed">
              Ask anything about this site — the projects, the stack behind them, the
              experience. Answers come from the site&rsquo;s own pages, with links to
              where they came from.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setPinned(true);
                    send(suggestion);
                  }}
                  className="border-line text-muted hover:border-accent hover:text-accent rounded-[2px] border px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <Turn key={message.id} message={message} />)
        )}
      </div>

      {/* Composer */}
      <div className="border-line shrink-0 border-t pt-3">
        {(offline || notReady) && (
          <p className="text-[var(--c-warn)] mb-2 font-mono text-[11px]">
            {offline
              ? 'The assistant is offline — it runs on a small free host.'
              : 'The assistant is starting up. Try again shortly.'}
          </p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            rows={density === 'compact' ? 2 : 3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line — the convention every
              // chat UI shares, and the one people try first.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            aria-label="Ask a question about this site"
            disabled={offline || notReady}
            className="border-line bg-surface text-fg placeholder:text-faint focus:border-accent min-h-0 flex-1 resize-none rounded-[var(--r-md)] border px-3 py-2 text-sm leading-relaxed outline-none transition-colors disabled:opacity-60"
          />
          <button
            type="button"
            onClick={busy ? stop : submit}
            disabled={busy ? false : disabled || !draft.trim()}
            className="bg-accent-fill text-[var(--c-accent-on-fill)] hover:brightness-95 shrink-0 rounded-[var(--r-md)] px-3.5 py-2.5 font-mono text-[11px] font-medium tracking-wide uppercase transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Stop' : 'Ask'}
          </button>
        </div>

        <div className="text-faint mt-2 flex items-center justify-between gap-3 font-mono text-[10px]">
          <span>Answers are generated and can be wrong — follow the source links.</span>
          {!empty && (
            <button
              type="button"
              onClick={reset}
              className="hover:text-accent shrink-0 underline underline-offset-2 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
