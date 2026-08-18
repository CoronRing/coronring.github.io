import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ask,
  health,
  suggestions as fetchSuggestions,
  type ChatHealth,
  type ChatMessage,
} from '../../lib/site-chat-api';

/**
 * Conversation state, shared by the corner dock and the full page.
 *
 * Both surfaces are the same assistant, so they are the same hook — the only
 * difference between them is layout. Keeping the state here means a change to
 * how streaming or errors behave lands in both at once, rather than in whichever
 * one was edited.
 *
 * The transcript is intentionally *not* persisted across page loads. On a static
 * site every internal link is a full navigation, so persistence would mean a
 * half-read answer reappearing on an unrelated page. The dock and the page each
 * hold their own conversation for as long as the document lives.
 */

/** Shown before the backend answers, and if it never does. */
const FALLBACK_SUGGESTIONS = [
  'What does Guan work on?',
  'Walk me through his experience.',
  'What is Particle Wave?',
];

let messageCounter = 0;

/** Stable ids without a `crypto.randomUUID` dependency. */
function nextId(prefix: string): string {
  messageCounter += 1;
  return `${prefix}-${messageCounter}`;
}

export interface UseChat {
  messages: ChatMessage[];
  /** True from send until the stream closes. */
  busy: boolean;
  /** Null until the first health check resolves; null again if it fails. */
  status: ChatHealth | null;
  /** False once a health check has failed — used to explain a disabled composer. */
  reachable: boolean;
  suggestions: string[];
  send: (text: string) => void;
  reset: () => void;
  /** Abort an in-flight answer. */
  stop: () => void;
}

/**
 * Drive one conversation with the site assistant.
 *
 * @param active Whether this surface is visible. The dock passes `false` while
 *   collapsed so a closed panel does not spend a request probing health on every
 *   page load.
 */
export function useChat(active: boolean = true): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ChatHealth | null>(null);
  /** Probe started. */
  const [probed, setProbed] = useState(false);
  /** Probe finished — distinct from `probed`, so an in-flight check does
   *  not read as an unreachable backend and grey out the composer. */
  const [settled, setSettled] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS);

  const abortRef = useRef<AbortController | null>(null);
  /** Guards against a stream writing into state after unmount. */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Probe once, the first time this surface becomes active.
  useEffect(() => {
    if (!active || probed) return;
    const controller = new AbortController();
    setProbed(true);

    void health(controller.signal).then((result) => {
      if (!mountedRef.current) return;
      setStatus(result);
      setSettled(true);
      if (result?.ready) {
        void fetchSuggestions(controller.signal).then((list) => {
          if (mountedRef.current && list.length) setSuggestions(list);
        });
      }
    });

    return () => controller.abort();
  }, [active, probed]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setBusy(false);
  }, []);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;

      const question: ChatMessage = { id: nextId('u'), role: 'user', content: text };
      const answerId = nextId('a');

      // Snapshot the history *before* this turn. Reading `messages` inside the
      // stream callbacks would capture a stale closure and resend the wrong
      // context on the next question.
      let history: ChatMessage[] = [];
      setMessages((prev) => {
        history = prev;
        return [...prev, question, { id: answerId, role: 'assistant', content: '' }];
      });

      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);

      const patch = (change: Partial<ChatMessage>): void => {
        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === answerId ? { ...m, ...change } : m)),
        );
      };

      void ask(
        text,
        history,
        {
          onStart: ({ model, cached, degraded }) => patch({ model, cached, degraded }),
          onDelta: (delta) => {
            if (!mountedRef.current) return;
            setMessages((prev) =>
              prev.map((m) => (m.id === answerId ? { ...m, content: m.content + delta } : m)),
            );
          },
          onDone: ({ citations, model }) => patch({ citations, model }),
          onError: (message) => {
            if (!mountedRef.current) return;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== answerId) return m;
                // Keep whatever already streamed and append the failure. An
                // answer cut off after two useful sentences is worth more to
                // the reader than an error message that discards them.
                const partial = m.content.trim();
                return {
                  ...m,
                  content: partial ? `${partial}\n\n${message}` : message,
                  error: true,
                };
              }),
            );
          },
        },
        controller.signal,
      ).finally(() => {
        if (!mountedRef.current) return;
        setBusy(false);
        abortRef.current = null;
      });
    },
    [busy],
  );

  return {
    messages,
    busy,
    status,
    reachable: !settled || status !== null,
    suggestions,
    send,
    reset,
    stop,
  };
}
