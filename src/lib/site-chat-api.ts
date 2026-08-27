/**
 * Client for the site-chat service.
 *
 * Streams answers over server-sent events. `EventSource` is not used and cannot
 * be: it only issues GET requests, and a question plus a transcript belongs in
 * a POST body rather than a URL that would be logged by every hop in between.
 * So the SSE framing is parsed by hand off `fetch`'s response body, which is
 * about fifteen lines and buys full control over headers and cancellation.
 *
 * The backend is a free-tier host and the site must never depend on it being
 * up. Every failure path here ends in a readable message rather than a thrown
 * stack, because the only thing the UI can usefully do with a dead backend is
 * say so.
 */

/**
 * Where the service answers.
 *
 * Overridable with `PUBLIC_SITE_CHAT_API` for a local backend. The default is
 * baked in because the GitHub Pages build has no `.env`, and an unset variable
 * there would silently disable chat on the one deployment that matters. The
 * URL is public information, not a credential.
 *
 * The host moved on 2026-08-27, when Oracle halved the Always Free
 * allowance; see MIGRATE.md for the old URL and the reasoning.
 */
export const CHAT_API_BASE: string = (
  import.meta.env.PUBLIC_SITE_CHAT_API ?? 'https://129-146-25-154.sslip.io/chat'
).replace(/\/+$/, '');

/** A page the answer drew on. */
export interface Citation {
  route: string;
  title: string;
  url: string;
}

/** One turn of the conversation, as the UI holds it. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  /** Set on an assistant turn that failed, so the UI can style it as an error. */
  error?: boolean;
  /** Which model answered — shown in the full-page HUD. */
  model?: string;
  /** True when a fallback model answered because the preferred ones were busy. */
  degraded?: boolean;
  /** True when served from the backend's answer cache, with no model call. */
  cached?: boolean;
}

/** Callbacks driven by the stream. */
export interface StreamHandlers {
  /** First event: the answer is committed and text is about to arrive. */
  onStart?: (info: { model: string; cached: boolean; degraded: boolean }) => void;
  onDelta: (text: string) => void;
  onDone: (info: {
    citations: Citation[];
    model: string;
    elapsedMs: number;
    /** The answer stopped before it was finished. Say so rather than
     *  presenting a fragment as a complete reply. */
    truncated: boolean;
  }) => void;
  onError: (message: string) => void;
}

/** Health snapshot, used to label the UI before anything is sent. */
export interface ChatHealth {
  status: string;
  ready: boolean;
  models: string[];
  corpus: { loaded: boolean; pages?: number; approx_tokens?: number; hash?: string };
}

/**
 * How long to wait for the first byte.
 *
 * Generous because the backend may be walking its own model fallback chain
 * underneath this request — a busy model can take twenty seconds just to refuse
 * — and cutting it off early would abandon an answer that was still coming.
 */
const FIRST_BYTE_TIMEOUT_MS = 75_000;

/** Is the service up? Used to disable the composer rather than fail on send. */
export async function health(signal?: AbortSignal): Promise<ChatHealth | null> {
  try {
    const response = await fetch(`${CHAT_API_BASE}/api/health`, {
      signal,
      credentials: 'omit',
    });
    if (!response.ok) return null;
    return (await response.json()) as ChatHealth;
  } catch {
    return null;
  }
}

/** Opening prompts for an empty transcript. Falls back to a static set. */
export async function suggestions(signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(`${CHAT_API_BASE}/api/suggestions`, {
      signal,
      credentials: 'omit',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { suggestions?: string[] };
    return body.suggestions ?? [];
  } catch {
    return [];
  }
}

/**
 * Ask a question and stream the answer.
 *
 * Resolves when the stream ends. Never rejects for an expected failure — a dead
 * backend, a rate limit, a refusal — those arrive through `onError` so the
 * caller has one place to handle them. It only rejects if the caller aborts.
 *
 * @param message  The visitor's question.
 * @param history  Prior turns, oldest first.
 * @param handlers Stream callbacks.
 * @param signal   Aborts the request — pass the one that fires on unmount.
 */
export async function ask(
  message: string,
  history: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FIRST_BYTE_TIMEOUT_MS);
  const onAbort = (): void => deadline.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${CHAT_API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      signal: deadline.signal,
      body: JSON.stringify({
        message,
        // Only the fields the server accepts. Sending the UI's own bookkeeping
        // (ids, citations, model labels) would be rejected as extra input and
        // wastes prompt budget besides.
        history: history
          .filter((m) => !m.error && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      handlers.onError(await readError(response));
      return;
    }

    // First byte arrived; the remaining time belongs to the answer.
    clearTimeout(timer);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. Anything after the last
      // separator is a partial frame and stays in the buffer.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        dispatch(event, handlers);
      }
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      // A caller-initiated abort is not a failure to report.
      if (signal?.aborted) return;
      handlers.onError('The assistant took too long to respond. Try again.');
      return;
    }
    handlers.onError(
      'Could not reach the assistant. It runs on a small free host and may be asleep.',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Route one decoded SSE event to the right handler. */
function dispatch(event: Record<string, unknown>, handlers: StreamHandlers): void {
  switch (event.type) {
    case 'meta':
      handlers.onStart?.({
        model: String(event.model ?? ''),
        cached: Boolean(event.cached),
        degraded: Boolean(event.degraded),
      });
      break;
    case 'delta':
      handlers.onDelta(String(event.text ?? ''));
      break;
    case 'done':
      handlers.onDone({
        citations: Array.isArray(event.citations) ? (event.citations as Citation[]) : [],
        model: String(event.model ?? ''),
        elapsedMs: Number(event.elapsed_ms ?? 0),
        truncated: Boolean(event.truncated),
      });
      break;
    case 'error':
      handlers.onError(String(event.message ?? 'Something went wrong.'));
      break;
    default:
      break;
  }
}

/** Turn a non-OK response into the clearest message available. */
async function readError(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((body: { detail?: string }) => body.detail)
    .catch(() => undefined);
  if (detail) return detail;
  if (response.status === 429) return 'Too many questions at once. Give it a moment.';
  if (response.status === 503) return 'The assistant is warming up. Try again shortly.';
  return `The assistant returned ${response.status}.`;
}
