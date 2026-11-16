import { useEffect, useState } from 'react';
import { LANDING_COPY, readLandingState, type LandingState } from '../../lib/newsring-api';
import SubscribeForm from './SubscribeForm';

/**
 * The signup form, plus whatever the service sent the visitor back to say.
 *
 * Confirming a subscription and unsubscribing both end in a redirect to this
 * page carrying `?state=...`, so that every page a reader sees is in the
 * site's own design rather than a bare JSON response from a box with an IP
 * address for a name.
 *
 * The state is read in the browser because the page is static: GitHub Pages
 * serves one HTML file and knows nothing about the query string. That means
 * the banner appears a frame after paint, which is why the form is rendered
 * first and the banner above it, rather than the page waiting on it.
 *
 * The parameter is a label, never content: it is matched against a fixed list
 * and anything else is ignored, so a crafted link cannot put text on the page.
 */

interface Props {
  /** Which surface this instance sits on, recorded with the signup. */
  source?: string;
}

export default function SubscribePanel({ source = 'signup-page' }: Props) {
  const [state, setState] = useState<LandingState | null>(null);

  useEffect(() => {
    setState(readLandingState(window.location.search));
    // Take the parameter out of the URL once it has been read, so a reload or
    // a shared link does not repeat "you are unsubscribed" at someone who is
    // not. The page itself is unchanged, so `replaceState` is right.
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const copy = state ? LANDING_COPY[state] : null;

  return (
    <div>
      {copy && (
        <div
          role="status"
          className={`mb-8 border-l-4 py-3 pl-4 ${
            copy.tone === 'ok'
              ? 'border-[var(--c-ok)] bg-[var(--c-raised)]'
              : 'border-[var(--c-warn)] bg-[var(--c-raised)]'
          }`}
        >
          <p className="font-mono text-xs tracking-wide uppercase">{copy.title}</p>
          <p className="text-muted mt-1.5 text-sm leading-relaxed">{copy.body}</p>
        </div>
      )}
      <SubscribeForm source={source} />
    </div>
  );
}
