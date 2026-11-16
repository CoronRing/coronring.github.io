import { useEffect, useState } from 'react';
import { NEWSRING, type NewsFeed } from '../../data/newsring';
import SubscribeForm from '../news/SubscribeForm';
import type { DemoProps } from './registry';

/**
 * NewsRing's live demo: this morning's digest, and the form that sends it.
 *
 * The other demos on this site let you drive an engine. This one cannot —
 * the product is an email that arrives tomorrow morning. So the demo shows
 * the thing itself: today's real digest, fetched from the same fixed URL the
 * News Today post and the deck read, with the signup beside it. What a
 * visitor is being asked to subscribe to is on screen while they decide.
 *
 * The feed is fetched when the island hydrates, which is `client:visible`, so
 * a visitor who never scrolls this far costs the backend nothing. A failed
 * fetch leaves the signup working and says the preview is missing, rather
 * than showing an empty frame or invented headlines.
 */

type Load = { state: 'loading' } | { state: 'ready'; feed: NewsFeed } | { state: 'failed' };

export default function NewsRingDemo({ title }: DemoProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(NEWSRING.feed, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('feed'))))
      .then((feed: NewsFeed) => setLoad({ state: 'ready', feed }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoad({ state: 'failed' });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Today's digest, as it actually is this morning. */}
      <div className="border-line min-w-0 border-b p-5 md:border-r md:border-b-0 md:p-6">
        <p className="eyebrow">{load.state === 'ready' ? `Today · ${load.feed.date}` : 'Today'}</p>

        {load.state === 'loading' && (
          <p className="text-faint mt-4 font-mono text-xs">Fetching this morning’s digest…</p>
        )}

        {load.state === 'failed' && (
          <p className="text-faint mt-4 text-sm leading-relaxed">
            Today’s digest could not be fetched here, which is a problem with this preview rather
            than with the digest.{' '}
            <a href={NEWSRING.page} className="text-accent underline">
              Read it on the web
            </a>
            .
          </p>
        )}

        {load.state === 'ready' && (
          <>
            <h3 className="display mt-3 text-2xl leading-tight">{load.feed.title}</h3>
            <ul className="divide-line mt-4 divide-y">
              {load.feed.headlines.slice(0, 3).map((headline) => (
                <li key={headline.headline} className="py-3">
                  <p className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
                    {headline.kicker}
                  </p>
                  <p className="mt-1 text-sm font-medium">{headline.headline}</p>
                  <p className="text-muted mt-1 text-[13px] leading-relaxed">{headline.blurb}</p>
                </li>
              ))}
            </ul>
            <p className="text-faint mt-4 font-mono text-[11px]">{load.feed.stats}</p>
          </>
        )}
      </div>

      {/* The signup. Same component as the signup page, same service. */}
      <div className="min-w-0 p-5 md:p-6">
        <p className="eyebrow">Get it tomorrow morning</p>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          {title} sends one digest a day. Everyone on the list gets the same one — this one.
        </p>
        <div className="mt-5">
          <SubscribeForm source="project-demo" compact />
        </div>
      </div>
    </div>
  );
}
