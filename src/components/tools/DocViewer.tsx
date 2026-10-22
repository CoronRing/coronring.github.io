/**
 * Document & Media Viewer tool island.
 *
 * Provides unlisted, shareable document rendering for GitHub files, raw URLs,
 * camo proxies, general web links, site documentation, and local files from disk
 * across Markdown, HTML, Video, Audio, Images, and Code.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

import {
  type DocKind,
  type ResolvedDoc,
  createLocalFileDoc,
  formatFileSize,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLElement>(null);
  const dragCounter = useRef<number>(0);
  const [themeTick, setThemeTick] = useState<number>(0);

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

  // Local file state (loaded in-memory via file picker or drag-and-drop)
  const [localDoc, setLocalDoc] = useState<ResolvedDoc | null>(null);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

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

  // Active doc: in-memory local file takes precedence over URL doc
  const activeDoc = localDoc || resolvedDoc;

  // Active kind takes dynamic override into account
  const activeKind: DocKind = overrideKind ?? activeDoc?.kind ?? 'markdown';

  // Read URL query parameter on popstate (browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readUrlDoc = () => {
      const params = new URLSearchParams(window.location.search);
      const doc = params.get('doc') || '';
      if (doc) {
        if (localBlobUrl) {
          URL.revokeObjectURL(localBlobUrl);
          setLocalBlobUrl(null);
        }
        setLocalDoc(null);
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
  }, [forceToolMode, localBlobUrl]);

  // Push new doc to URL query without full reload
  const navigateToDoc = useCallback(
    (urlToView: string) => {
      const trimmed = urlToView.trim();
      if (!trimmed) return;

      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
        setLocalBlobUrl(null);
      }
      setLocalDoc(null);

      setDocParam(trimmed);
      setInputUrl(trimmed);
      setError(null);
      setOverrideKind(null);

      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('doc', trimmed);
        window.history.pushState(null, '', newUrl.toString());
      }
    },
    [localBlobUrl],
  );

  // Clear current document and reset state
  const handleClear = useCallback(() => {
    if (localBlobUrl) {
      URL.revokeObjectURL(localBlobUrl);
      setLocalBlobUrl(null);
    }
    setLocalDoc(null);
    setInputUrl('');
    setDocParam('');
    setError(null);
    setTextContent('');
    setRenderedMarkdownHtml('');
    setOverrideKind(null);

    if (typeof window !== 'undefined') {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('doc');
      window.history.pushState(null, '', newUrl.toString());
    }
  }, [localBlobUrl]);

  // Load a local file in memory via File API
  const handleLoadLocalFile = useCallback(
    async (file: File) => {
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
        setLocalBlobUrl(null);
      }

      setError(null);
      setOverrideKind(null);
      setLoading(true);

      const doc = createLocalFileDoc(file);

      // Media and PDF files require an object URL for browser rendering
      if (
        doc.kind === 'video' ||
        doc.kind === 'audio' ||
        doc.kind === 'image' ||
        doc.kind === 'pdf'
      ) {
        const objUrl = URL.createObjectURL(file);
        doc.rawUrl = objUrl;
        setLocalBlobUrl(objUrl);
        setLocalDoc(doc);
        setInputUrl(file.name);
        setLoading(false);
        return;
      }

      // Text-based files (Markdown, Code, HTML, Plain Text)
      try {
        const text = await file.text();
        setTextContent(text);

        if (doc.kind === 'markdown') {
          const rawHtml = await marked.parse(text, {
            gfm: true,
            breaks: true,
          });
          const sanitized = DOMPurify.sanitize(rawHtml, {
            ADD_ATTR: ['target', 'rel', 'loading'],
            ADD_TAGS: ['iframe'],
          });
          setRenderedMarkdownHtml(sanitized);
        }

        setLocalDoc(doc);
        setInputUrl(file.name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to read local file: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [localBlobUrl],
  );

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [localBlobUrl]);

  // Fetch document content when resolvedDoc changes
  useEffect(() => {
    // If a local file is active, skip remote fetching
    if (localDoc) return;

    if (!resolvedDoc) {
      setTextContent('');
      setRenderedMarkdownHtml('');
      setError(null);
      return;
    }

    // OS local filesystem path detected (e.g. C:\... or /Users/...)
    // Browsers forbid fetching local disk paths via HTTP requests
    if (resolvedDoc.isLocalFsPath) {
      setLoading(false);
      setError('LOCAL_FS_PATH');
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
  }, [resolvedDoc, localDoc, activeKind]);

  // Listen for theme changes to automatically refresh Mermaid diagram themes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          setThemeTick((t) => t + 1);
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => setThemeTick((t) => t + 1);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  // Render Mermaid diagrams whenever Markdown HTML or theme changes
  useEffect(() => {
    if (activeKind !== 'markdown' || !markdownRef.current) return;

    let isMounted = true;

    const renderMermaid = async () => {
      const container = markdownRef.current;
      if (!container) return;

      // Find code blocks marked with mermaid or previously rendered containers needing re-render
      const allElements = container.querySelectorAll<HTMLElement>(
        'code[class*="mermaid" i], pre[class*="mermaid" i], div[data-mermaid-source]',
      );

      if (allElements.length === 0) return;

      try {
        const mermaid = (await import('mermaid')).default;
        const isDark =
          document.documentElement.dataset.theme === 'dark' ||
          (!document.documentElement.dataset.theme &&
            window.matchMedia('(prefers-color-scheme: dark)').matches);

        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'neutral',
          securityLevel: 'loose',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        });

        const elementList = Array.from(allElements);
        for (let i = 0; i < elementList.length; i++) {
          if (!isMounted) break;
          const el = elementList[i];
          if (!el) continue;

          let rawCode = '';
          let targetToReplace: HTMLElement | null = null;

          if (el.hasAttribute('data-mermaid-source')) {
            rawCode = el.getAttribute('data-mermaid-source') || '';
            targetToReplace = el;
          } else {
            rawCode = el.textContent?.trim() || '';
            const pre = el.tagName.toLowerCase() === 'pre' ? el : el.closest('pre');
            targetToReplace = pre;
          }

          if (!rawCode || !targetToReplace) continue;

          const uniqueId = `mermaid-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;

          try {
            const { svg, bindFunctions } = await mermaid.render(uniqueId, rawCode);
            if (!isMounted) break;

            const diagramWrapper = document.createElement('div');
            diagramWrapper.className =
              'mermaid-container my-6 flex flex-col items-center justify-center overflow-x-auto rounded-md border border-[var(--c-line)] bg-[var(--c-raised)]/35 p-6 shadow-xs';
            diagramWrapper.setAttribute('data-mermaid-source', rawCode);
            diagramWrapper.innerHTML = svg;

            const svgElement = diagramWrapper.querySelector('svg');
            if (svgElement) {
              svgElement.style.maxWidth = '100%';
              svgElement.style.height = 'auto';
            }

            if (bindFunctions) {
              bindFunctions(diagramWrapper);
            }

            targetToReplace.replaceWith(diagramWrapper);
          } catch (err: unknown) {
            console.warn('Failed to render Mermaid diagram:', err);
            const stray =
              document.getElementById(uniqueId) || document.getElementById(`d${uniqueId}`);
            if (stray) stray.remove();

            if (targetToReplace && !targetToReplace.querySelector('.mermaid-err-notice')) {
              const notice = document.createElement('div');
              notice.className =
                'mermaid-err-notice mb-2 font-mono text-[11px] font-semibold text-[var(--c-alert)]';
              notice.textContent = '⚠️ Mermaid diagram syntax error (showing raw source):';
              targetToReplace.prepend(notice);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to initialize mermaid:', err);
      }
    };

    void renderMermaid();

    return () => {
      isMounted = false;
    };
  }, [renderedMarkdownHtml, activeKind, themeTick]);

  // Compute canonical share link for copying (only available for remote docs)
  const shareableUrl = useMemo(() => {
    if (typeof window === 'undefined' || !docParam || activeDoc?.isLocalFile) return '';
    const base = `${window.location.origin}/viewer`;
    return `${base}?doc=${encodeURIComponent(docParam)}`;
  }, [docParam, activeDoc?.isLocalFile]);

  // Drag-and-drop handlers for dropping files directly into the viewer
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleLoadLocalFile(file);
    }
  };

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input for opening files from computer */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".md,.markdown,.mdx,.html,.htm,.txt,.json,.yaml,.yml,.toml,.py,.ts,.tsx,.js,.jsx,.css,.scss,.sql,.rs,.go,.c,.cpp,.h,.csv,.tsv,.log,.png,.jpg,.jpeg,.gif,.svg,.webp,.bmp,.ico,.pdf,.mp4,.webm,.mov,.mp3,.wav,.m4a"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void handleLoadLocalFile(file);
          }
          e.target.value = '';
        }}
      />

      {/* Drag & Drop Visual Backdrop / Overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-md border-2 border-dashed border-[var(--c-accent)] bg-[var(--c-surface)]/95 p-6 shadow-xl backdrop-blur-xs">
          <div className="mb-2 flex size-14 items-center justify-center rounded-full border border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-2xl">
            📂
          </div>
          <div className="font-mono text-sm font-bold tracking-wider text-[var(--c-accent)] uppercase">
            Drop Document or Media to View
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--c-text-muted)]">
            Markdown, HTML, Code, Image, Audio, Video, or PDF
          </p>
        </div>
      )}

      {/* ── Minimalist Reader Control Bar (when document is loaded) ─────── */}
      {activeDoc && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] px-3.5 py-2 shadow-xs">
          {/* Document metadata info */}
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
            <span className="size-2 shrink-0 rounded-full bg-[var(--c-ok)]" />
            <span
              className="max-w-[180px] truncate font-bold text-[var(--c-text)] sm:max-w-xs md:max-w-md"
              title={activeDoc.fileName}
            >
              {activeDoc.fileName}
            </span>
            {activeDoc.repo && (
              <span className="hidden max-w-[220px] truncate text-[var(--c-text-faint)] sm:inline">
                ({activeDoc.repo}@{activeDoc.branch})
              </span>
            )}
            {activeDoc.fileSize !== undefined && (
              <span className="hidden text-[var(--c-text-faint)] sm:inline">
                ({formatFileSize(activeDoc.fileSize)})
              </span>
            )}
            <Badge tone="accent">
              {activeDoc.isLocalFile ? 'LOCAL FILE' : activeKind.toUpperCase()}
            </Badge>
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
            <Button
              variant="quiet"
              onClick={() => fileInputRef.current?.click()}
              title="Open a different file from disk"
            >
              📂 Open File
            </Button>
            {shareableUrl && <CopyButton text={shareableUrl} label="Copy Link" />}
            {activeDoc.isLocalFile && textContent && (
              <CopyButton text={textContent} label="Copy Content" />
            )}
            {!activeDoc.isLocalFile && (
              <a
                href={activeDoc.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent-fill)] hover:text-[var(--c-accent)]"
              >
                {activeDoc.isGitHub ? 'GitHub ↗' : 'Source ↗'}
              </a>
            )}
            {!activeDoc.isLocalFile && activeDoc.rawUrl !== activeDoc.sourceUrl && (
              <a
                href={activeDoc.rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent-fill)] hover:text-[var(--c-accent)]"
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
                placeholder="Enter GitHub URL (blob/raw), web URL, or site doc (/docs/demo.md)..."
                className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-1.5 font-mono text-[12px] text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent)] focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button type="submit" variant="primary" disabled={!inputUrl.trim()}>
                Fetch & View
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                title="Select a local file from disk"
              >
                📂 Open Local File...
              </Button>
              {(inputUrl || activeDoc) && (
                <Button variant="ghost" onClick={handleClear}>
                  Clear
                </Button>
              )}
            </div>
          </form>

          {/* Presets Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--c-line)] pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
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
                  className="group inline-flex items-center gap-1 rounded-sm border border-[var(--c-line)] bg-[var(--c-raised)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent-fill)] hover:text-[var(--c-text)]"
                >
                  <span>{preset.label}</span>
                  <span className="text-[9.5px] text-[var(--c-text-faint)] group-hover:text-[var(--c-accent)]">
                    · {preset.kind}
                  </span>
                </button>
              ))}
            </div>
            <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
              💡 Tip: Drag and drop any file directly onto this window
            </span>
          </div>
        </div>
      )}

      {/* ── Context-Aware Error Banner ───────────────────────────────────── */}
      {error && activeDoc && (
        <ErrorNote>
          <div className="flex flex-col gap-2.5">
            {activeDoc.isLocalFsPath || error === 'LOCAL_FS_PATH' ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-wide text-[var(--c-alert)] uppercase">
                    Local Filesystem Path Detected
                  </span>
                  <Badge tone="alert">Browser Security Restriction</Badge>
                </div>
                <div className="flex flex-col gap-2 text-xs text-[var(--c-text-muted)]">
                  <p>
                    You entered a local file path:{' '}
                    <code className="rounded bg-[var(--c-sunken)] px-1.5 py-0.5 font-mono break-all text-[var(--c-text)]">
                      {activeDoc.rawUrl}
                    </code>
                  </p>
                  <p>
                    For security reasons, web browsers cannot directly read files from your hard
                    drive via path strings. To view this file, click the button below to pick it
                    from your computer, or drag and drop the file directly onto this page.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                      📂 Select "{activeDoc.fileName}" from Computer
                    </Button>
                    <Button variant="ghost" onClick={handleClear}>
                      Clear
                    </Button>
                  </div>
                </div>
              </div>
            ) : activeDoc.isGitHub ? (
              /* GitHub Specific Diagnosis & Links */
              <div className="flex flex-col gap-2 text-xs text-[var(--c-text-muted)]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-wide uppercase">
                    GitHub Document Not Found
                  </span>
                  <Badge tone="alert">{error}</Badge>
                </div>
                <p>
                  The requested file{' '}
                  <code className="rounded bg-[var(--c-sunken)] px-1 py-0.5">
                    {activeDoc.fileName}
                  </code>{' '}
                  was not found at{' '}
                  <span className="font-mono text-[11px] break-all">{activeDoc.rawUrl}</span>.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {activeDoc.repoUrl && (
                    <a
                      href={activeDoc.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                    >
                      📁 Browse {activeDoc.repo} ↗
                    </a>
                  )}
                  {activeDoc.repo && activeDoc.branch && (
                    <a
                      href={`https://github.com/${activeDoc.repo}/tree/${activeDoc.branch}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                    >
                      🌿 Check '{activeDoc.branch}' branch ↗
                    </a>
                  )}
                  <a
                    href={activeDoc.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--c-accent)] hover:underline"
                  >
                    🔗 Try Direct Link on GitHub ↗
                  </a>
                </div>
                <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">
                  Common reasons: file does not exist on branch <code>{activeDoc.branch}</code>,
                  file was renamed/moved, or repository is private (client-side viewer cannot access
                  private GitHub repos without auth).
                </p>
              </div>
            ) : (
              /* General External URL Diagnosis & Links */
              <div className="flex flex-col gap-2 text-xs text-[var(--c-text-muted)]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-wide uppercase">
                    Failed to Load External Document
                  </span>
                  <Badge tone="alert">{error}</Badge>
                </div>
                <p>
                  Could not fetch content from{' '}
                  <span className="font-mono text-[11px] break-all">{activeDoc.sourceUrl}</span>.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={activeDoc.sourceUrl}
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
          <span className="mb-3 size-5 animate-spin rounded-full border-2 border-[var(--c-accent-fill)] border-t-transparent" />
          <span className="font-mono text-xs text-[var(--c-text-muted)]">
            Fetching and rendering document...
          </span>
        </div>
      )}

      {!loading && !error && activeDoc && (
        <div className="overflow-hidden rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] shadow-[var(--shadow-panel)]">
          {/* 1. MARKDOWN VIEWER */}
          {activeKind === 'markdown' && (
            <div className="mx-auto max-w-4xl p-6 sm:p-10">
              <article
                ref={markdownRef}
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
                  title={activeDoc.fileName}
                  sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
                  srcDoc={textContent || undefined}
                  src={!textContent ? activeDoc.rawUrl : undefined}
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
                src={activeDoc.rawUrl}
              >
                Your browser does not support the video tag.
              </video>
              <div className="mt-4 flex items-center gap-3">
                <span className="font-mono text-xs text-[var(--c-text-muted)]">
                  {activeDoc.fileName}
                </span>
                <a
                  href={activeDoc.rawUrl}
                  download={activeDoc.fileName}
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
                    {activeDoc.fileName}
                  </span>
                  <Badge tone="accent">AUDIO</Badge>
                </div>
                <audio controls className="w-full" src={activeDoc.rawUrl}>
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
                  src={activeDoc.rawUrl}
                  alt={activeDoc.fileName}
                  referrerPolicy="no-referrer"
                  className="max-h-[75vh] max-w-full object-contain"
                  style={{ minWidth: '140px', minHeight: '140px' }}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (activeDoc.sourceUrl && img.src !== activeDoc.sourceUrl) {
                      img.src = activeDoc.sourceUrl;
                    }
                  }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                <span className="font-mono text-xs font-semibold text-[var(--c-text)]">
                  {activeDoc.fileName}
                </span>
                {!activeDoc.isLocalFile && (
                  <>
                    <span className="font-mono text-xs text-[var(--c-text-faint)]">·</span>
                    <a
                      href={activeDoc.rawUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-[var(--c-accent)] underline underline-offset-4"
                    >
                      Direct Media Link ↗
                    </a>
                  </>
                )}
                {!activeDoc.isLocalFile && activeDoc.sourceUrl !== activeDoc.rawUrl && (
                  <>
                    <span className="font-mono text-xs text-[var(--c-text-faint)]">·</span>
                    <a
                      href={activeDoc.sourceUrl}
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
                title={activeDoc.fileName}
                src={activeDoc.rawUrl}
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
      {!activeDoc && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="group cursor-pointer rounded-md border border-dashed border-[var(--c-line)] bg-[var(--c-surface)] p-12 text-center transition-all hover:border-[var(--c-accent)] hover:bg-[var(--c-raised)]/30"
        >
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-raised)] text-xl transition-all group-hover:border-[var(--c-accent)] group-hover:bg-[var(--c-accent-soft)]">
            📂
          </div>
          <div className="mb-1 font-mono text-sm font-semibold text-[var(--c-text)]">
            No document selected
          </div>
          <p className="mx-auto max-w-md font-mono text-xs leading-relaxed text-[var(--c-text-muted)]">
            Enter a GitHub document link, general web link, select a preset above, or open a file
            from your computer.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              📂 Open Local File from Computer
            </Button>
          </div>
          <p className="mt-3 font-mono text-[11px] text-[var(--c-text-faint)]">
            or drag and drop any Markdown, HTML, Code, Image, Audio, Video, or PDF file here
          </p>
        </div>
      )}
    </div>
  );
}
