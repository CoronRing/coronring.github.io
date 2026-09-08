/**
 * Document & Media Viewer tool island.
 *
 * Provides unlisted, shareable document rendering for GitHub files, raw URLs,
 * and local docs across Markdown, HTML, Video, Audio, Images, and Code.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

import {
  type ResolvedDoc,
  resolveDocSource,
  resolveRelativeUrl,
} from '../../lib/doc-resolver';
import { Badge, Button, CopyButton, ErrorNote, Panel } from './ui';

export interface DocViewerProps {
  /** Optional initial document query passed from page. */
  initialDoc?: string;
  /** Force tool mode with expanded controls rather than auto-reader mode. */
  forceToolMode?: boolean;
}

const PRESETS = [
  {
    label: 'RailtownAI · AGENTS.md',
    kind: 'Markdown',
    url: 'https://github.com/RailtownAI/railtracks/blob/main/AGENTS.md',
  },
  {
    label: 'RailtownAI · AGENTS.html',
    kind: 'HTML',
    url: 'https://raw.githubusercontent.com/RailtownAI/railtracks/main/AGENTS.html',
  },
  {
    label: 'RailtownAI · AGENTS.mp4',
    kind: 'Video',
    url: '/RailtownAI/railtracks/main/AGENTS.mp4',
  },
  {
    label: 'Local · demo.md',
    kind: 'Local',
    url: '/docs/demo.md',
  },
] as const;

type ViewportWidth = '100%' | '1200px' | '768px' | '375px';

export default function DocViewer({
  initialDoc = '',
  forceToolMode = false,
}: DocViewerProps): React.ReactElement {
  const inputId = useId();

  // URL state
  const [docParam, setDocParam] = useState<string>(initialDoc);
  const [inputUrl, setInputUrl] = useState<string>(initialDoc);
  const [showInputBar, setShowInputBar] = useState<boolean>(forceToolMode || !initialDoc);

  // Content state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>('');
  const [renderedMarkdownHtml, setRenderedMarkdownHtml] = useState<string>('');
  const [htmlViewport, setHtmlViewport] = useState<ViewportWidth>('100%');

  // Parse docParam whenever it changes
  const resolvedDoc = useMemo<ResolvedDoc | null>(() => {
    if (!docParam) return null;
    return resolveDocSource(docParam, typeof window !== 'undefined' ? window.location.origin : '');
  }, [docParam]);

  // Read URL query parameter on client mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readUrlDoc = () => {
      const params = new URLSearchParams(window.location.search);
      const doc = params.get('doc') || '';
      if (doc) {
        setDocParam(doc);
        setInputUrl(doc);
        if (!forceToolMode) {
          setShowInputBar(false);
        }
      } else if (!forceToolMode) {
        setShowInputBar(true);
      }
    };

    readUrlDoc();
    window.addEventListener('popstate', readUrlDoc);
    return () => window.removeEventListener('popstate', readUrlDoc);
  }, [forceToolMode]);

  // Push new doc to URL query without full reload
  const navigateToDoc = useCallback((urlToView: string) => {
    const trimmed = urlToView.trim();
    if (!trimmed) return;

    setDocParam(trimmed);
    setInputUrl(trimmed);
    setError(null);

    if (typeof window !== 'undefined') {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('doc', trimmed);
      window.history.pushState(null, '', newUrl.toString());
    }
  }, []);

  // Fetch document content when resolvedDoc changes
  useEffect(() => {
    if (!resolvedDoc) {
      setTextContent('');
      setRenderedMarkdownHtml('');
      setError(null);
      return;
    }

    // Media and PDF files do not need text fetching
    if (
      resolvedDoc.kind === 'video' ||
      resolvedDoc.kind === 'audio' ||
      resolvedDoc.kind === 'image' ||
      resolvedDoc.kind === 'pdf'
    ) {
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetch(resolvedDoc.rawUrl)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? `Document not found (404) at ${resolvedDoc.rawUrl}`
              : `Failed to fetch document: HTTP ${res.status} ${res.statusText}`,
          );
        }
        return res.text();
      })
      .then(async (text) => {
        if (!isMounted) return;
        setTextContent(text);

        if (resolvedDoc.kind === 'markdown') {
          // Configure marked parser
          const rawHtml = await marked.parse(text, {
            gfm: true,
            breaks: true,
          });

          // Post-process HTML to resolve relative images and links against baseUrl
          const parser = new DOMParser();
          const doc = parser.parseFromString(rawHtml, 'text/html');

          // Rewrite relative images
          doc.querySelectorAll('img').forEach((img) => {
            const src = img.getAttribute('src');
            if (src) {
              img.setAttribute('src', resolveRelativeUrl(src, resolvedDoc.baseUrl));
              img.setAttribute('loading', 'lazy');
              img.classList.add('rounded-md', 'border', 'border-[var(--c-line)]', 'my-3');
            }
          });

          // Rewrite relative links
          doc.querySelectorAll('a').forEach((a) => {
            const href = a.getAttribute('href');
            if (href) {
              const isRelative = !/^(https?:\/\/|mailto:|#)/i.test(href);
              if (isRelative) {
                // If it's a relative markdown file, point to viewer!
                if (href.endsWith('.md') || href.endsWith('.markdown')) {
                  const resolvedTarget = resolveRelativeUrl(href, resolvedDoc.baseUrl);
                  a.setAttribute('href', `/viewer?doc=${encodeURIComponent(resolvedTarget)}`);
                } else {
                  a.setAttribute('href', resolveRelativeUrl(href, resolvedDoc.baseUrl));
                  a.setAttribute('target', '_blank');
                  a.setAttribute('rel', 'noopener noreferrer');
                }
              } else {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
              }
            }
          });

          // Sanitize sanitized HTML
          const sanitized = DOMPurify.sanitize(doc.body.innerHTML, {
            ADD_ATTR: ['target', 'rel', 'loading'],
            ADD_TAGS: ['iframe'],
          });

          setRenderedMarkdownHtml(sanitized);
        }

        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [resolvedDoc]);

  // Compute canonical share link for copying
  const shareableUrl = useMemo(() => {
    if (typeof window === 'undefined' || !docParam) return '';
    const base = `${window.location.origin}/viewer`;
    return `${base}?doc=${encodeURIComponent(docParam)}`;
  }, [docParam]);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Top Bar / Tool Mode Controls ─────────────────────────────────── */}
      <Panel
        title="Document Source"
        aside={
          <div className="flex items-center gap-2">
            {resolvedDoc && (
              <Badge tone="accent">{resolvedDoc.kind.toUpperCase()}</Badge>
            )}
            {resolvedDoc && (
              <Button
                variant="quiet"
                onClick={() => setShowInputBar((prev) => !prev)}
                title="Toggle URL Input & Presets"
              >
                {showInputBar ? '▲ Hide URL Bar' : '▼ Change URL'}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          {/* Collapsible Input Field & Presets */}
          {showInputBar && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  navigateToDoc(inputUrl);
                }}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <div className="relative flex-1">
                  <input
                    id={inputId}
                    type="text"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="e.g. https://github.com/RailtownAI/railtracks/blob/main/AGENTS.md"
                    className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-2 font-mono text-[12px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--c-accent)]"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!inputUrl.trim()}
                  >
                    Fetch & View
                  </Button>
                  {inputUrl && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setInputUrl('');
                        setDocParam('');
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </form>

              {/* Presets Strip */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--c-line)]">
                <span className="eyebrow text-[10px] text-[var(--c-text-faint)]">
                  Presets:
                </span>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => {
                      setInputUrl(preset.url);
                      navigateToDoc(preset.url);
                    }}
                    className="group inline-flex items-center gap-1.5 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-text)]"
                  >
                    <span>{preset.label}</span>
                    <span className="text-[10px] text-[var(--c-text-faint)] group-hover:text-[var(--c-accent)]">
                      · {preset.kind}
                    </span>
                  </button>
                ))}
              </div>

              {/* Supported formats hint */}
              <p className="font-mono text-[11px] text-[var(--c-text-faint)] leading-relaxed">
                Accepts GitHub blob URLs (auto-converts to raw), raw GitHub URLs, shorthand repo paths (e.g.{' '}
                <code>/RailtownAI/railtracks/main/AGENTS.mp4</code>), and local paths.
              </p>
            </>
          )}

          {/* Active Document Header Rail */}
          {resolvedDoc && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 overflow-hidden font-mono text-xs">
                <span className="size-2 rounded-full bg-[var(--c-ok)]" />
                <span className="font-semibold text-[var(--c-text)] truncate">
                  {resolvedDoc.fileName}
                </span>
                {resolvedDoc.repo && (
                  <span className="text-[var(--c-text-faint)] hidden sm:inline">
                    ({resolvedDoc.repo}@{resolvedDoc.branch})
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {shareableUrl && <CopyButton text={shareableUrl} label="Copy Share Link" />}
                <a
                  href={resolvedDoc.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
                >
                  View Source ↗
                </a>
                <a
                  href={resolvedDoc.rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
                >
                  Raw ↗
                </a>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      {error && (
        <ErrorNote>
          <div className="flex flex-col gap-2">
            <div className="font-bold">Failed to load document:</div>
            <div>{error}</div>
            <div className="text-[10.5px] text-[var(--c-text-faint)]">
              Common causes: private repository (GitHub requires authentication), non-existent branch, or CORS restriction.
              {resolvedDoc?.sourceUrl && (
                <span className="ml-1">
                  Try opening{' '}
                  <a
                    href={resolvedDoc.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-[var(--c-accent)]"
                  >
                    directly on GitHub
                  </a>
                  .
                </span>
              )}
            </div>
          </div>
        </ErrorNote>
      )}

      {/* ── Content Viewers ──────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-16 border border-[var(--c-line)] rounded-md bg-[var(--c-surface)]">
          <span className="size-5 animate-spin rounded-full border-2 border-[var(--c-accent)] border-t-transparent mb-3" />
          <span className="font-mono text-xs text-[var(--c-text-muted)]">
            Fetching and rendering document...
          </span>
        </div>
      )}

      {!loading && !error && resolvedDoc && (
        <div className="rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] shadow-[var(--shadow-panel)] overflow-hidden">
          {/* 1. MARKDOWN VIEWER */}
          {resolvedDoc.kind === 'markdown' && (
            <div className="p-6 sm:p-10 max-w-4xl mx-auto">
              <article
                className="doc-prose text-[15px] leading-relaxed text-[var(--c-text)]"
                dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
              />
            </div>
          )}

          {/* 2. HTML VIEWER */}
          {resolvedDoc.kind === 'html' && (
            <div className="flex flex-col">
              {/* Viewport Width Toolbar */}
              <div className="flex items-center justify-between border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2">
                <span className="eyebrow text-[10px] text-[var(--c-text-faint)]">
                  Sandbox Viewport
                </span>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { label: 'Full', width: '100%' },
                      { label: 'Desktop', width: '1200px' },
                      { label: 'Tablet', width: '768px' },
                      { label: 'Mobile', width: '375px' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.width}
                      type="button"
                      onClick={() => setHtmlViewport(item.width)}
                      className={`px-2 py-1 font-mono text-[10.5px] rounded-sm transition-colors ${
                        htmlViewport === item.width
                          ? 'bg-[var(--c-accent-fill)] text-[var(--c-accent-on-fill)] font-bold'
                          : 'text-[var(--c-text-muted)] hover:bg-[var(--c-surface)]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sandboxed iframe */}
              <div className="flex justify-center bg-[var(--c-sunken)] p-4 overflow-x-auto min-h-[70vh]">
                <iframe
                  title={resolvedDoc.fileName}
                  sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
                  srcDoc={textContent || undefined}
                  src={!textContent ? resolvedDoc.rawUrl : undefined}
                  style={{ width: htmlViewport }}
                  className="min-h-[75vh] rounded border border-[var(--c-line)] bg-white shadow-md transition-all"
                />
              </div>
            </div>
          )}

          {/* 3. VIDEO VIEWER */}
          {resolvedDoc.kind === 'video' && (
            <div className="flex flex-col items-center justify-center p-6 sm:p-10 bg-[var(--c-sunken)]">
              <video
                controls
                playsInline
                preload="metadata"
                className="max-h-[75vh] w-full max-w-4xl rounded-md border border-[var(--c-line)] bg-black shadow-lg"
                src={resolvedDoc.rawUrl}
              >
                Your browser does not support the video tag.
              </video>
              <div className="mt-4 flex items-center gap-3">
                <span className="font-mono text-xs text-[var(--c-text-muted)]">
                  {resolvedDoc.fileName}
                </span>
                <a
                  href={resolvedDoc.rawUrl}
                  download={resolvedDoc.fileName}
                  className="font-mono text-xs text-[var(--c-accent)] underline underline-offset-4"
                >
                  Download Video
                </a>
              </div>
            </div>
          )}

          {/* 4. AUDIO VIEWER */}
          {resolvedDoc.kind === 'audio' && (
            <div className="flex flex-col items-center justify-center p-12 bg-[var(--c-sunken)]">
              <div className="w-full max-w-lg rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] p-6 shadow-md">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-[var(--c-text)]">
                    {resolvedDoc.fileName}
                  </span>
                  <Badge tone="accent">AUDIO</Badge>
                </div>
                <audio controls className="w-full" src={resolvedDoc.rawUrl}>
                  Your browser does not support audio playback.
                </audio>
              </div>
            </div>
          )}

          {/* 5. IMAGE VIEWER */}
          {resolvedDoc.kind === 'image' && (
            <div className="flex flex-col items-center justify-center p-8 bg-[var(--c-sunken)]">
              <img
                src={resolvedDoc.rawUrl}
                alt={resolvedDoc.fileName}
                className="max-h-[80vh] max-w-full rounded-md border border-[var(--c-line)] object-contain shadow-lg"
              />
              <div className="mt-3 font-mono text-xs text-[var(--c-text-faint)]">
                {resolvedDoc.fileName}
              </div>
            </div>
          )}

          {/* 6. PDF VIEWER */}
          {resolvedDoc.kind === 'pdf' && (
            <div className="p-4 bg-[var(--c-sunken)] min-h-[75vh]">
              <iframe
                title={resolvedDoc.fileName}
                src={resolvedDoc.rawUrl}
                className="w-full h-[80vh] rounded border border-[var(--c-line)]"
              />
            </div>
          )}

          {/* 7. CODE & PLAIN TEXT VIEWER */}
          {(resolvedDoc.kind === 'code' || resolvedDoc.kind === 'text') && (
            <div className="flex flex-col">
              <div className="flex items-center justify-between border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2">
                <span className="eyebrow text-[10px] text-[var(--c-text-faint)]">
                  {textContent.split('\n').length} lines · {textContent.length.toLocaleString()} characters
                </span>
                <CopyButton text={textContent} label="Copy Source" />
              </div>
              <pre className="overflow-x-auto bg-[var(--c-sunken)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--c-text)] whitespace-pre-wrap">
                <code>{textContent}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Empty State when no document is loaded */}
      {!resolvedDoc && (
        <div className="rounded-md border border-dashed border-[var(--c-line)] p-12 text-center bg-[var(--c-surface)]">
          <div className="font-mono text-sm text-[var(--c-text)] font-semibold mb-2">
            No document selected
          </div>
          <p className="font-mono text-xs text-[var(--c-text-faint)] max-w-md mx-auto leading-relaxed">
            Enter a GitHub document link above or select one of the presets to view a document. You can share the resulting URL directly with others.
          </p>
        </div>
      )}
    </div>
  );
}
