import { type ReactElement } from 'react';

import Conversation from './Conversation';
import { useChat } from './useChat';

/**
 * ChatPage — the full-surface assistant.
 *
 * Used twice: as the `#ask` band on the home page, and as `/chat` for anyone
 * who lands on it directly. Same component both times, because they are the
 * same assistant and a second variant is how two surfaces start drifting.
 *
 * ## Why the prose went
 *
 * This used to carry two paragraphs explaining that the site is small enough
 * to answer without retrieval, and a third about a planned execution view.
 * True, and interesting to the person who built it. A visitor came here to ask
 * a question, and every line above the box is a line between them and asking.
 * What survives is the status strip, which is the honest disclosure that this
 * runs on a free tier and may be answering from a fallback model.
 */
export default function ChatPage(): ReactElement {
  const chat = useChat(true);
  const { status, messages } = chat;

  const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && m.model);

  const facts: ReadonlyArray<[string, string]> = [
    ['Service', status ? (status.ready ? 'ready' : 'starting') : 'unreachable'],
    ['Pages read', status?.corpus?.pages ? String(status.corpus.pages) : '—'],
    ['Answered by', lastAnswer?.model ?? '—'],
  ];

  return (
    <div className="space-y-4">
      <div className="border-line bg-surface flex h-[min(66dvh,38rem)] flex-col border p-4 sm:p-6">
        <Conversation chat={chat} density="full" />
      </div>

      <div className="border-line text-faint flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 font-mono text-[11px]">
        {facts.map(([label, value]) => (
          <span key={label}>
            <span className="opacity-70">{label} </span>
            <span className="text-muted">{value}</span>
          </span>
        ))}
        {lastAnswer?.degraded && (
          <span className="text-[var(--c-warn)]">
            fallback model · the preferred ones were busy
          </span>
        )}
      </div>
    </div>
  );
}
