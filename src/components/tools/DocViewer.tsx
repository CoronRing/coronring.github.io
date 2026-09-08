/**
 * Document & Media Viewer tool island.
 *
 * Provides unlisted, shareable document rendering for GitHub files, raw URLs,
 * camo proxies, general web links, and local docs across Markdown, HTML, Video,
 * Audio, Images, and Code.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

import {
  type DocKind,
  type ResolvedDoc,
  resolveDocSource,
  resolveRelativeUrl,
} from '../../lib/doc-resolver';
import { Badge, Button, CopyButton, ErrorNote } from './ui';

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
    label: 'RailtownAI · logo.svg',
    kind: 'GitHub SVG',
    url: 'https://raw.githubusercontent.com/RailtownAI/railtracks/main/docs/assets/logo.svg',
  },
  {
    label: 'Telemetry · preview.html',
    kind: 'HTML Sandbox',
    url: '/docs/preview.html',
  },
  {
    label: 'Operations · demo.md',
    kind: 'Local Demo',
    url: '/docs/demo.md',
  },
] as const;

type ViewportWidth = '100%' | '1200px' | '768px' | '375px';

export default function DocViewer({
  initialDoc = '',
  forceToolMode = false,
}: DocViewerProps): React.ReactElement {
  const inputId = useId();

  // Helper to read initial doc from window.location if in browser, else fallback to initialDoc
  const getInitialDoc = (): string => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const doc = params.get('doc');
        if (doc) return doc.trim();
      } catch {
        // ignore
      }
    }
    return (initialDoc || '').trim();
  };

  // URL state
  const [docParam, setDocParam] = useState<string>(getInitialDoc);
  const [inputUrl, setInputUrl] = useState<string>(getInitialDoc);
  const [showInputBar, setShowInputBar] = useState<boolean>(() => {
    const initial = getInitialDoc();
    return forceToolMode || !initial;
  });

  // Content state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>('');
  const [renderedMarkdownHtml, setRenderedMarkdownHtml] = useState<string>('');
  const [htmlViewport, setHtmlViewport] = useState<ViewportWidth>('100%');
  const [overrideKind, setOverrideKind] = useState<DocKind | null>(null);

  // Parse docParam whenever it changes
  const resolvedDoc = useMemo<ResolvedDoc | null>(() => {
    if (!docParam) return null;
    return resolveDocSource(docParam, typeof window !== 'undefined' ? window.location.origin : '');
  }, [docParam]);

  // Active kind takes dynamic override into account
  const activeKind: DocKind = overrideKind ?? resolvedDoc?.kind ?? 'markdown';

  // Read URL query parameter on popstate (browser back/forward)
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
    setOverrideKind(null);

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

    // Media and PDF files do not need text fetching: browser renders them directly
    if (
      activeKind === 'video' ||
      activeKind === 'audio' ||
      activeKind === 'image' ||
      activeKind === 'pdf'
    ) {
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    // Fetch attempt with CORS fallback for general web URLs
    const fetchWithFallback = async (targetUrl: string): Promise<string> => {
      try {
        const res = await fetch(targetUrl);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        // Sniff Content-Type header if available
        const contentType = res.headers.get('content-type')?.toLowerCase() || '';
        if (contentType.includes('image/')) {
          if (isMounted) setOverrideKind('image');
          return '';
        }
        if (contentType.includes('video/')) {
          if (isMounted) setOverrideKind('video');
          return '';
        }
        if (contentType.includes('audio/')) {
          if (isMounted) setOverrideKind('audio');
          return '';
        }
        if (contentType.includes('application/pdf')) {
          if (isMounted) setOverrideKind('pdf');
          return '';
        }
        if (contentType.includes('text/html') && activeKind !== 'html') {
          if (isMounted) setOverrideKind('html');
        }

        return await res.text();
      } catch (err: unknown) {
        // If direct fetch failed and it's a general non-GitHub URL, try CORS proxy fallback
        if (!resolvedDoc.isGitHub && !resolvedDoc.rawUrl.startsWith('/')) {
          try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
            const proxyRes = await fetch(proxyUrl);
            if (proxyRes.ok) {
              return await proxyRes.text();
            }
          } catch {
            // fallback also failed, throw original error
          }
        }
        throw err;
      }
    };

    fetchWithFallback(resolvedDoc.rawUrl)
      .then(async (text) => {
        if (!isMounted) return;
        setTextContent(text);

        if (activeKind === 'markdown') {
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

          // Sanitize HTML
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
  }, [resolvedDoc, activeKind]);

  // Compute canonical share link for copying
  const shareableUrl = useMemo(() => {
    if (typeof window === 'undefined' || !docParam) return '';
    const base = `${window.location.origin}/viewer`;
    return `${base}?doc=${encodeURIComponent(docParam)}`;
  }, [docParam]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Minimalist Reader Control Bar (when document is loaded) ─────── */}
      {resolvedDoc && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] px-3.5 py-2 shadow-xs">
          {/* Document metadata info */}
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
            <span className="size-2 shrink-0 rounded-full bg-[var(--c-ok)]" />
            <span
              className="max-w-[180px] truncate font-bold text-[var(--c-text)] sm:max-w-xs md:max-w-md"
              title={resolvedDoc.fileName}
            >
              {resolvedDoc.fileName}
            </span>
            {resolvedDoc.repo && (
              <span className="hidden max-w-[220px] truncate text-[var(--c-text-faint)] sm:inline">
                ({resolvedDoc.repo}@{resolvedDoc.branch})
              </span>
            )}
            <Badge tone="accent">{activeKind.toUpperCase()}</Badge>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              variant="quiet"
              onClick={() => setShowInputBar((prev) => !prev)}
              title="Toggle URL Input & Presets"
            >
              {showInputBar ? '▲ Hide URL Bar' : '▼ Change URL'}
            </Button>
            {shareableUrl && <CopyButton text={shareableUrl} label="Copy Link" />}
            <a
              href={resolvedDoc.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
            >
              {resolvedDoc.isGitHub ? 'GitHub ↗' : 'Source ↗'}
            </a>
            {resolvedDoc.rawUrl !== resolvedDoc.sourceUrl && (
              <a
                href={resolvedDoc.rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
              >
                Raw ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Collapsible URL Input & Presets Drawer ───────────────────────── */}
      {showInputBar && (
        <div className="flex flex-col gap-2.5 rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] p-3.5 shadow-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigateToDoc(inputUrl);
              setShowInputBar(false);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <div className="relative flex-1">
              <input
                id={inputId}
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Enter GitHub URL (blob/raw), web document, or local path..."
                className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-1.5 font-mono text-[12px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent)] focus:outline-none"
              />
            </div>
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" disabled={!inputUrl.trim()}>
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
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--c-line)] pt-2">
            <span className="eyebrow text-[10px] text-[var(--c-text-faint)]">Presets:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.url}
                type="button"
                onClick={() => {
                  setInputUrl(preset.url);
                  navigateToDoc(preset.url);
                  setShowInputBar(false);
                }}
                className="group inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-text)]"
              >
                <span>{preset.label}</span>
                <span className="text-[9.5px] text-[var(--c-text-faint)] group-hover:text-[var(--c-accent)]">
                  · {preset.kind}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Context-Aware Error Banner ───────────────────────────────────── */}
      {error && resolvedDoc && (
        <ErrorNote>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wide uppercase">
                {resolvedDoc.isGitHub
                  ? 'GitHub Document Not Found'
                  : 'Failed to Load External Document'}
              </span>
              <Badge tone="alert">{error}</Badge>
            </div>

            {/* GitHub Specific Diagnosis & Links */}
            {resolvedDoc.isGitHub ? (
              <div className="flex flex-col gap-2 text-xs text-[var(--c-text-muted)]">
                <p>
                  The requested file{' '}
                  <code className="rounded bg-[var(--c-sunken)] px-1 py-0.5">
                    {resolvedDoc.fileName}
                  </code>{' '}
                  was not found at{' '}
                  <span className="font-mono text-[11px] break-all">{resolvedDoc.rawUrl}</span>.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {resolvedDoc.repoUrl && (
                    <a
                      href={resolvedDoc.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                    >
                      📁 Browse {resolvedDoc.repo} ↗
                    </a>
                  )}
                  {resolvedDoc.repo && resolvedDoc.branch && (
                    <a
                      href={`https://github.com/${resolvedDoc.repo}/tree/${resolvedDoc.branch}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                    >
                      🌿 Check '{resolvedDoc.branch}' branch ↗
                    </a>
                  )}
                  <a
                    href={resolvedDoc.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                  >
                    🔗 Try Direct Link on GitHub ↗
                  </a>
                </div>
                <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">
                  Common reasons: file does not exist on branch <code>{resolvedDoc.branch}</code>,
                  file was renamed/moved, or repository is private (client-side viewer cannot access
                  private GitHub repos without auth).
                </p>
              </div>
            ) : (
              /* General External URL Diagnosis & Links */
              <div className="flex flex-col gap-2 text-xs text-[var(--c-text-muted)]">
                <p>
                  Could not fetch content from{' '}
                  <span className="font-mono text-[11px] break-all">{resolvedDoc.sourceUrl}</span>.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={resolvedDoc.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                  >
                    🔗 Open Direct Link in New Tab ↗
                  </a>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOverrideKind('image');
                      setError(null);
                    }}
                  >
                    🖼️ Try Render as Image
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOverrideKind('html');
                      setError(null);
                    }}
                  >
                    🌐 Try Render in Sandbox Frame
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">
                  Remote servers often restrict cross-origin script fetching (CORS). Images and
                  iframes can still be rendered directly via browser embedding.
                </p>
              </div>
            )}
          </div>
        </ErrorNote>
      )}

      {/* ── Content Viewers ──────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] p-16">
          <span className="mb-3 size-5 animate-spin rounded-full border-2 border-[var(--c-accent)] border-t-transparent" />
          <span className="font-mono text-xs text-[var(--c-text-muted)]">
            Fetching and rendering document...
          </span>
        </div>
      )}

      {!loading && !error && resolvedDoc && (
        <div className="overflow-hidden rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] shadow-[var(--shadow-panel)]">
          {/* 1. MARKDOWN VIEWER */}
          {activeKind === 'markdown' && (
            <div className="mx-auto max-w-4xl p-6 sm:p-10">
              <article
                className="doc-prose text-[15px] leading-relaxed text-[var(--c-text)]"
                dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
              />
            </div>
          )}

          {/* 2. HTML VIEWER */}
          {activeKind === 'html' && (
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
                      className={`rounded-sm px-2 py-1 font-mono text-[10.5px] transition-colors ${
                        htmlViewport === item.width
                          ? 'bg-[var(--c-accent-fill)] font-bold text-[var(--c-accent-on-fill)]'
                          : 'text-[var(--c-text-muted)] hover:bg-[var(--c-surface)]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sandboxed iframe */}
              <div className="flex min-h-[70vh] justify-center overflow-x-auto bg-[var(--c-sunken)] p-4">
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
          {activeKind === 'video' && (
            <div className="flex flex-col items-center justify-center bg-[var(--c-sunken)] p-6 sm:p-10">
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
          {activeKind === 'audio' && (
            <div className="flex flex-col items-center justify-center bg-[var(--c-sunken)] p-12">
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
          {activeKind === 'image' && (
            <div className="flex flex-col items-center justify-center bg-[var(--c-sunken)] p-6 sm:p-10">
              <div className="relative flex min-h-[280px] max-w-4xl min-w-[280px] items-center justify-center overflow-hidden rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] p-8 shadow-md">
                <img
                  src={resolvedDoc.rawUrl}
                  alt={resolvedDoc.fileName}
                  referrerPolicy="no-referrer"
                  className="max-h-[75vh] max-w-full object-contain"
                  style={{ minWidth: '140px', minHeight: '140px' }}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (resolvedDoc.sourceUrl && img.src !== resolvedDoc.sourceUrl) {
                      img.src = resolvedDoc.sourceUrl;
                    }
                  }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                <span className="font-mono text-xs font-semibold text-[var(--c-text)]">
                  {resolvedDoc.fileName}
                </span>
                <span className="font-mono text-xs text-[var(--c-text-faint)]">·</span>
                <a
                  href={resolvedDoc.rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[var(--c-accent)] underline underline-offset-4"
                >
                  Direct Media Link ↗
                </a>
                {resolvedDoc.sourceUrl !== resolvedDoc.rawUrl && (
                  <>
                    <span className="font-mono text-xs text-[var(--c-text-faint)]">·</span>
                    <a
                      href={resolvedDoc.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-[var(--c-text-muted)] underline underline-offset-4 hover:text-[var(--c-accent)]"
                    >
                      Proxy Link ↗
                    </a>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 6. PDF VIEWER */}
          {activeKind === 'pdf' && (
            <div className="min-h-[75vh] bg-[var(--c-sunken)] p-4">
              <iframe
                title={resolvedDoc.fileName}
                src={resolvedDoc.rawUrl}
                className="h-[80vh] w-full rounded border border-[var(--c-line)]"
              />
            </div>
          )}

          {/* 7. CODE & PLAIN TEXT VIEWER */}
          {(activeKind === 'code' || activeKind === 'text') && (
            <div className="flex flex-col">
              <div className="flex items-center justify-between border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2">
                <span className="eyebrow text-[10px] text-[var(--c-text-faint)]">
                  {textContent.split('\n').length} lines · {textContent.length.toLocaleString()}{' '}
                  characters
                </span>
                <CopyButton text={textContent} label="Copy Source" />
              </div>
              <pre className="overflow-x-auto bg-[var(--c-sunken)] p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--c-text)]">
                <code>{textContent}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Empty State when no document is loaded */}
      {!resolvedDoc && (
        <div className="rounded-md border border-dashed border-[var(--c-line)] bg-[var(--c-surface)] p-12 text-center">
          <div className="mb-2 font-mono text-sm font-semibold text-[var(--c-text)]">
            No document selected
          </div>
          <p className="mx-auto max-w-md font-mono text-xs leading-relaxed text-[var(--c-text-faint)]">
            Enter a GitHub document link, general web link, or select one of the presets above to
            view a document. You can share the resulting URL directly with others.
          </p>
        </div>
      )}
    </div>
  );
}
