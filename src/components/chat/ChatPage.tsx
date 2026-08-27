import { type ReactElement } from 'react';

import Conversation from './Conversation';
import { useChat } from './useChat';

/**
 * ChatPage — the full-surface assistant at `/chat`.
 *
 * Same conversation as the corner dock, given room: a taller transcript and a
 * status rail that says which model answered and what it was reading. That rail
 * is not decoration — it is the honest disclosure that this is a free-tier
 * service walking a fallback chain, and it is where the planned Railtracks
 * execution view will attach once there is a graph worth showing.
 */
export default function ChatPage(): ReactElement {
  const chat = useChat(true);
  const { status, messages } = chat;

  const corpus = status?.corpus;
  const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && m.model);

  const facts: ReadonlyArray<[string, string]> = [
    ['Backend', status ? (status.ready ? 'ready' : 'starting') : 'unreachable'],
    ['Pages indexed', corpus?.pages ? String(corpus.pages) : '—'],
    [
      'Corpus size',
      corpus?.approx_tokens ? `~${corpus.approx_tokens.toLocaleString('en-US')} tokens` : '—',
    ],
    ['Answered by', lastAnswer?.model ?? '—'],
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
      {/* Conversation */}
      <div className="border-line bg-surface flex h-[min(72dvh,44rem)] flex-col border p-4 sm:p-6">
        <Conversation chat={chat} density="full" />
      </div>

      {/* Status rail */}
      <aside className="space-y-6 lg:pt-2">
        <div>
          <p className="eyebrow eyebrow-marked">Status</p>
          <dl className="mt-4 space-y-2.5">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-faint font-mono text-[11px]">{label}</dt>
                <dd className="text-muted truncate font-mono text-[11px]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {lastAnswer?.degraded && (
          <p className="font-mono text-[11px] leading-relaxed text-[var(--c-warn)]">
            Answered by a fallback model, because the preferred ones were rate-limited.
          </p>
        )}

        <div className="border-line border-t pt-5">
          <p className="eyebrow">How it works</p>
          <p className="text-muted mt-3 text-[13px] leading-relaxed">
            The whole site is about four thousand tokens, so there is no retrieval step and no
            vector database. Every question is answered against the <em>complete</em> text of every
            page, which is why the answers can cite exactly where they came from.
          </p>
          <p className="text-muted mt-3 text-[13px] leading-relaxed">
            That text is identical on every request, so the model provider&rsquo;s implicit cache
            absorbs most of it and the repetition costs far less than sending it fresh each time.
          </p>
        </div>

        <div className="border-line border-t pt-5">
          <p className="eyebrow">Planned</p>
          <p className="text-muted mt-3 text-[13px] leading-relaxed">
            An execution view of each answer: the model chain, the fallbacks and the timing,
            rendered from the same trace the backend already records.
          </p>
        </div>
      </aside>
    </div>
  );
}
