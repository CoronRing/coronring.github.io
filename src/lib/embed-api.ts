/**
 * Client for the site's embedding endpoint.
 *
 * Same host and the same posture as `site-chat-api.ts`: a free-tier backend
 * that the page must never depend on. Every failure ends in a readable message,
 * because the only useful thing the UI can do about a dead backend is say so
 * and fall back to the local engine.
 *
 * @see chat/service/main.py for the endpoint
 * @see src/lib/semantic.ts for what consumes the vectors
 */

import { CHAT_API_BASE } from './site-chat-api';

/**
 * Where the service answers.
 *
 * Derived from the chat base rather than configured separately: they are the
 * same deployment, and two variables that must agree are one variable with a
 * bug waiting in it.
 */
export const EMBED_ENDPOINT = `${CHAT_API_BASE}/api/embed`;

export interface EmbedCapability {
  readonly enabled: boolean;
  readonly model: string;
  readonly dimensions: number;
  readonly maxTexts: number;
  readonly maxChars: number;
  readonly maxTotalChars: number;
}

export interface EmbedResult {
  readonly vectors: ReadonlyArray<readonly number[]>;
  readonly model: string;
  readonly dimensions: number;
  readonly taskType: string;
  readonly elapsedMs: number;
}

export class EmbedError extends Error {
  /** True where trying again might work: a timeout, a 429, a 503. */
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'EmbedError';
    this.retryable = retryable;
  }
}

/** Client-side ceiling, so an oversized request fails here rather than at the host. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ask the backend what it will accept.
 *
 * Called before the toggle is offered, so the UI can disable the remote engine
 * with a reason rather than letting someone click it and get a 503. Returns null
 * on any failure, which the caller reads as "assume unavailable".
 */
export async function probeCapability(signal?: AbortSignal): Promise<EmbedCapability | null> {
  try {
    const response = await fetch(`${CHAT_API_BASE}/api/health`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      embed?: {
        enabled?: boolean;
        model?: string;
        dimensions?: number;
        max_texts?: number;
        max_chars?: number;
        max_total_chars?: number;
      };
    };
    const embed = payload.embed;
    if (!embed) return null;
    return {
      enabled: embed.enabled === true,
      model: embed.model ?? 'unknown',
      dimensions: embed.dimensions ?? 768,
      maxTexts: embed.max_texts ?? 32,
      maxChars: embed.max_chars ?? 8_000,
      maxTotalChars: embed.max_total_chars ?? 100_000,
    };
  } catch {
    return null;
  }
}

/**
 * Embed a batch of texts.
 *
 * @param texts Texts to embed. The result is in the same order.
 * @param signal Abort signal, so a keystroke can cancel an in-flight request.
 * @throws EmbedError Always, on any failure. Never rejects with a raw fetch error.
 */
export async function embedTexts(
  texts: readonly string[],
  { signal, dimensions }: { signal?: AbortSignal; dimensions?: number } = {},
): Promise<EmbedResult> {
  if (texts.length === 0) {
    return { vectors: [], model: '', dimensions: 0, taskType: '', elapsedMs: 0 };
  }

  // Two abort sources, joined: the caller's signal and our own timeout. Without
  // the timeout a hung connection to a free-tier host leaves the UI showing a
  // spinner until the tab is closed.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS);
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(EMBED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dimensions === undefined ? { texts } : { texts, dimensions }),
      signal: controller.signal,
    });

    if (!response.ok) throw await describeFailure(response);

    const payload = (await response.json()) as {
      embeddings?: Array<{ values?: number[] }>;
      model?: string;
      dimensions?: number;
      task_type?: string;
      elapsed_ms?: number;
    };

    const vectors = (payload.embeddings ?? []).map((item) => item.values ?? []);
    if (vectors.length !== texts.length) {
      throw new EmbedError(
        `The service returned ${vectors.length} vectors for ${texts.length} texts, so they cannot be matched up.`,
      );
    }

    return {
      vectors,
      model: payload.model ?? 'unknown',
      dimensions: payload.dimensions ?? vectors[0]?.length ?? 0,
      taskType: payload.task_type ?? '',
      elapsedMs: payload.elapsed_ms ?? 0,
    };
  } catch (error) {
    if (error instanceof EmbedError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new EmbedError('The request was cancelled or timed out.', true);
    }
    // A cross-origin failure and a dead host are indistinguishable from here:
    // the browser reports both as an opaque TypeError with no detail, by design.
    throw new EmbedError(
      'Could not reach the embedding service. It runs on free-tier hardware and may be down. The local engine still works.',
      true,
    );
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Turn an error response into a message worth showing, using the server's detail. */
async function describeFailure(response: Response): Promise<EmbedError> {
  let detail = '';
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') detail = body.detail;
  } catch {
    /* not JSON, which is itself uninformative */
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    return new EmbedError(
      detail ||
        `Rate limited. Try again in ${retryAfter ?? 'a moment'}${retryAfter ? ' seconds' : ''}.`,
      true,
    );
  }
  if (response.status === 503) {
    return new EmbedError(detail || 'The embedding service is unavailable right now.', true);
  }
  if (response.status === 413) {
    return new EmbedError(detail || 'The texts are too large for one request.');
  }
  if (response.status === 422) {
    return new EmbedError(detail || 'The service rejected the request as malformed.');
  }
  return new EmbedError(
    detail || `The service answered ${response.status}.`,
    response.status >= 500,
  );
}
