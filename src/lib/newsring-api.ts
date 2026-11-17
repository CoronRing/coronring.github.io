/**
 * Client for the NewsRing subscriptions service.
 *
 * The service takes a signup, mails a confirmation link, and holds the list.
 * This file is everything the browser needs to talk to it: one POST, and the
 * reading of the `state` parameter the service redirects back with.
 *
 * As with the chat client next door, the backend is a free-tier host and the
 * site must never depend on it being up. Every failure path ends in a sentence
 * a visitor can act on, because the only useful thing a page can do with a
 * dead backend is say so and point at the digest on the web.
 */

/**
 * Where the service answers.
 *
 * Overridable with `PUBLIC_NEWSRING_API` for a local backend. The default is
 * baked in because the GitHub Pages build has no `.env`, and an unset variable
 * there would silently disable signups on the one deployment that matters. The
 * URL is public information, not a credential.
 */
export const NEWSRING_API_BASE: string = (
  import.meta.env.PUBLIC_NEWSRING_API ?? 'https://129-146-25-154.sslip.io/news'
).replace(/\/+$/, '');

/** What a signup attempt ended as. */
export type SubscribeOutcome =
  | { kind: 'pending'; message: string }
  | { kind: 'full'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

/** How long to wait before giving up on the backend. */
const TIMEOUT_MS = 12_000;

/**
 * Submit an address.
 *
 * Nothing is stored by this call: the service answers the same way for a new
 * address, one already on the list, and one still inside its cooldown window,
 * and mails a confirmation link where it is due. So there is no "already
 * subscribed" outcome to render, by design — see the service's README.
 *
 * @param email What the visitor typed. Validated properly on the server; the
 *   check in the form is only there to catch a typo before a round trip.
 * @param options.source Which surface the signup came from.
 * @param options.honeypot The off-screen field's value, passed straight
 *   through. A real visitor never fills it in.
 */
export async function subscribe(
  email: string,
  options: { source?: string; honeypot?: string } = {},
): Promise<SubscribeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${NEWSRING_API_BASE}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        source: options.source ?? 'site',
        website: options.honeypot ?? '',
      }),
      signal: controller.signal,
    });

    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      return {
        kind: 'invalid',
        message: detail(body) ?? 'That does not look like an email address.',
      };
    }
    if (response.status === 429) {
      return {
        kind: 'error',
        message: 'That is a lot of signups from one place. Give it a minute and try again.',
      };
    }
    if (response.status === 503) {
      return {
        kind: 'error',
        message: 'Signups are off at the moment. Today’s digest is still on the web.',
      };
    }
    if (!response.ok) {
      return {
        kind: 'error',
        message: 'The mailing list is not answering right now. Try again in a few minutes.',
      };
    }

    const body = (await response.json()) as { status?: string; message?: string };
    if (body.status === 'full') {
      return {
        kind: 'full',
        message: body.message ?? 'The list is full for now.',
      };
    }
    return {
      kind: 'pending',
      message:
        body.message ??
        'Check your inbox. There is a link to confirm, and today’s digest follows it.',
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return {
      kind: 'error',
      message: aborted
        ? 'The mailing list took too long to answer. Try again in a moment.'
        : 'The mailing list could not be reached. It runs on a small free-tier box, so this happens.',
    };
  } finally {
    clearTimeout(timer);
  }
}

function detail(body: unknown): string | null {
  if (body && typeof body === 'object' && 'detail' in body) {
    const value = (body as { detail: unknown }).detail;
    if (typeof value === 'string') return value;
  }
  return null;
}

/** The outcomes the service redirects back to the signup page with. */
export type LandingState =
  'confirmed' | 'confirmed-no-digest' | 'unsubscribed' | 'invalid' | 'full' | 'error';

const STATES: readonly LandingState[] = [
  'confirmed',
  'confirmed-no-digest',
  'unsubscribed',
  'invalid',
  'full',
  'error',
];

/**
 * Read the `state` parameter the service sent the visitor back with.
 *
 * Read in the browser rather than at build time because the page is static:
 * GitHub Pages serves one HTML file and knows nothing about the query string.
 */
export function readLandingState(search: string): LandingState | null {
  const value = new URLSearchParams(search).get('state');
  return STATES.includes(value as LandingState) ? (value as LandingState) : null;
}

/** What each landing state says to the visitor. */
export const LANDING_COPY: Record<
  LandingState,
  { tone: 'ok' | 'warn'; title: string; body: string }
> = {
  confirmed: {
    tone: 'ok',
    title: 'You are on the list',
    body: 'Today’s digest is on its way to your inbox, and the next one arrives tomorrow morning. Every email has an unsubscribe link at the foot.',
  },
  'confirmed-no-digest': {
    tone: 'ok',
    title: 'You are on the list',
    body: 'Today’s digest could not be fetched just now, so the next one you get will be tomorrow morning’s.',
  },
  unsubscribed: {
    tone: 'ok',
    title: 'Unsubscribed',
    body: 'Your address has been deleted, not flagged. Nothing further will be sent, and you are welcome back any time.',
  },
  invalid: {
    tone: 'warn',
    title: 'That link did not work',
    body: 'Confirmation links expire after two days. Enter your address again and a fresh one will be sent.',
  },
  full: {
    tone: 'warn',
    title: 'The list filled up first',
    body: 'It is capped while this runs on one ordinary mailbox. Today’s digest is on the web in the meantime.',
  },
  error: {
    tone: 'warn',
    title: 'That did not go through',
    body: 'Something failed at our end, so nothing was changed. Your link is still good for a couple of days — open it again in a few minutes and it should work.',
  },
};
