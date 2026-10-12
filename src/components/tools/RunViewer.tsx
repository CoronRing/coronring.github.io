import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canPickDirectory,
  ensureReadAccess,
  FolderSource,
  pickDirectory,
  readDrop,
  recallFolder,
  rememberFolder,
  type FolderSession,
  type FolderUpdate,
} from '../../lib/railtracks/folder';
import {
  FRAME_PATH,
  type FrameStyle,
  type FromFrame,
  type Palette,
  type Skin,
  type ToFrame,
  type Tone as PageTone,
} from '../../lib/railtracks/frame-protocol';
import { pageTone, readSitePalettes, watchPageTone } from '../../lib/railtracks/palette';
import { parseRunText, RunParseError, type LoadedSession } from '../../lib/railtracks/runs';
import {
  bundleUrl,
  fetchCatalog,
  visualizerForRailtracks,
  type VersionCatalog,
  type VisualizerVersion,
} from '../../lib/railtracks/versions';
import { href } from '../../lib/url';
import {
  EmptyStage,
  RunReadout,
  SessionList,
  SourceBadge,
  StatusDot,
  timeAgo,
  VersionControls,
  type VisualizerChoice,
} from './run-viewer-parts';
import { Badge, Button, ErrorNote, Panel, Segmented, Toggle, usePersisted } from './ui';

/**
 * RunViewer — open a Railtracks run and see its map, drawn by the official
 * visualizer at whichever version you pick.
 *
 * The visualizer is not part of this site. It is fetched from npm (through
 * esm.sh) on every visit, at the version chosen in the controls, and runs in
 * a sandboxed frame (`public/frames/railtracks-visualizer.html`). A new
 * visualizer release shows up here with no rebuild.
 *
 * What this file owns: where runs come from (a file, a paste, a drop, or a
 * watched folder, `lib/railtracks/folder.ts`), turning them into runs
 * (`lib/railtracks/runs.ts`), choosing the build (`lib/railtracks/versions.ts`)
 * and telling the frame what to draw. Run files are read in this tab and are
 * never sent anywhere; the frame only receives them by `postMessage`.
 */

type ToneChoice = 'auto' | PageTone;

type Source = { kind: 'file'; label: string } | { kind: 'folder'; folder: FolderSource };

type FrameState =
  | { phase: 'loading' }
  | { phase: 'ready'; version: string; ms: number; mounts: boolean }
  | { phase: 'error'; message: string };

/** What loads when npm cannot be reached: whatever esm.sh resolves as newest. */
const FALLBACK_VERSION: VisualizerVersion = {
  version: 'latest',
  line: 'v1',
  published: '',
  prerelease: false,
  reactMajor: 18,
  styles: ['https://esm.sh/@xyflow/react@12/dist/style.css'],
};

const SAMPLE_PATH = '/samples/railtracks-run.jsonl';

function resolveChoice(
  catalog: VersionCatalog | null,
  catalogError: string | null,
  choice: VisualizerChoice,
): VisualizerVersion | null {
  if (!catalog) return catalogError ? FALLBACK_VERSION : null;
  if (choice === 'latest:v1') return catalog.latest.v1 ?? FALLBACK_VERSION;
  if (choice === 'latest:v2') return catalog.latest.v2 ?? catalog.latest.v1 ?? FALLBACK_VERSION;
  return catalog.visualizers.find((v) => v.version === choice) ?? catalog.latest.v1;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export default function RunViewer(): React.ReactElement {
  /* ── Versions ── */
  const [catalog, setCatalog] = useState<VersionCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [choice, setChoice] = usePersisted<VisualizerChoice>('run-viewer.visualizer', 'latest:v1');
  const [railtracks, setRailtracks] = usePersisted<string>('run-viewer.railtracks', '');

  /* ── Style ── */
  const [skin, setSkin] = usePersisted<Skin>('run-viewer.skin', 'site');
  const [toneChoice, setToneChoice] = usePersisted<ToneChoice>('run-viewer.tone', 'auto');
  const [tone, setTone] = useState<PageTone>('dark');
  const [palettes, setPalettes] = useState<Record<PageTone, Palette>>({ light: {}, dark: {} });

  /* ── Source and selection ── */
  const [source, setSource] = useState<Source | null>(null);
  const [sessions, setSessions] = useState<FolderSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<LoadedSession | null>(null);
  const [runIndex, setRunIndex] = useState(0);
  const [follow, setFollow] = usePersisted<boolean>('run-viewer.follow', true);
  const [problem, setProblem] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle | null>(null);

  /* ── Frame ── */
  const [frame, setFrame] = useState<FrameState>({ phase: 'loading' });
  const frameRef = useRef<HTMLIFrameElement>(null);

  /* ── Page ── */
  const [mounted, setMounted] = useState(false);
  const [canFolder, setCanFolder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const resolved = useMemo(
    () => resolveChoice(catalog, catalogError, choice),
    [catalog, catalogError, choice],
  );
  const effectiveTone: PageTone = toneChoice === 'auto' ? tone : toneChoice;
  const style = useMemo<FrameStyle>(
    () => ({ skin, tone: effectiveTone, palettes }),
    [skin, effectiveTone, palettes],
  );
  const folder = source?.kind === 'folder' ? source.folder : null;

  /* ── Mount: browser capabilities, tone, palettes, catalog, remembered folder ── */
  useEffect(() => {
    setMounted(true);
    setCanFolder(canPickDirectory());
    setTone(pageTone());
    setPalettes(readSitePalettes());
    const stopTone = watchPageTone(setTone);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onFullscreen = (): void => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);

    const controller = new AbortController();
    fetchCatalog(controller.signal)
      .then(setCatalog)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : 'unreachable');
        }
      });
    void recallFolder().then(setRemembered);

    return () => {
      stopTone();
      window.clearInterval(tick);
      document.removeEventListener('fullscreenchange', onFullscreen);
      controller.abort();
    };
  }, []);

  /* ── Frame messages ── */
  const post = useCallback((message: ToFrame) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  // The frame is keyed on the version string, so this effect is too: a new
  // version mounts a fresh frame, which announces itself with `ready`.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const resolvedVersion = resolved?.version ?? null;

  useEffect(() => {
    if (!resolvedVersion) return;
    setFrame({ phase: 'loading' });
    const onMessage = (event: MessageEvent<FromFrame>): void => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = event.data;
      const target = resolvedRef.current;
      if (message.type === 'ready' && target) {
        post({
          type: 'load',
          bundle: bundleUrl(target),
          version: target.version,
          styles: target.styles,
        });
      } else if (message.type === 'loaded') {
        setFrame({
          phase: 'ready',
          version: message.version,
          ms: message.ms,
          mounts: message.exports.includes('mountRailtracksSession'),
        });
      } else if (message.type === 'error') {
        if (message.stage === 'load') setFrame({ phase: 'error', message: message.message });
        else setProblem(`The visualizer could not draw this run: ${message.message}`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [resolvedVersion, post]);

  // Draw whenever the run, the run picked within it, or the style changes.
  const mounts = frame.phase === 'ready' && frame.mounts;
  useEffect(() => {
    if (frame.phase !== 'ready') return;
    if (!session) {
      post({ type: 'clear' });
      return;
    }
    post({
      type: 'render',
      session: {
        id: session.id,
        name: session.name,
        source: session.source,
        runs: session.runs,
        // Raw events can run to megabytes; only a build that reads them gets them.
        events: mounts ? session.events : null,
      },
      runIndex: Math.min(runIndex, Math.max(0, session.runs.length - 1)),
      style,
    });
  }, [frame.phase, mounts, session, runIndex, style, post]);

  /* ── Loading runs ── */
  const showSingle = useCallback((text: string, label: string) => {
    try {
      const loaded = parseRunText(text, label);
      setSource({ kind: 'file', label });
      setSessions([]);
      setSelectedId(null);
      setSession(loaded);
      setRunIndex(0);
      setProblem(null);
    } catch (error) {
      setProblem(
        error instanceof RunParseError
          ? `${label}: ${error.message}`
          : `${label} could not be read.`,
      );
    }
  }, []);

  const preferKind = resolved?.line === 'v2' ? 'events' : 'session';

  const openSession = useCallback(
    async (target: FolderSource, id: string, keepRun: boolean) => {
      try {
        const loaded = await target.open(id, preferKind);
        setSession(loaded);
        if (!keepRun) setRunIndex(0);
        setProblem(null);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not read this session.');
      }
    },
    [preferKind],
  );

  const showFolder = useCallback(
    async (target: FolderSource) => {
      try {
        const update = await target.scan();
        setSource({ kind: 'folder', folder: target });
        setSessions(update.sessions);
        const first = update.sessions[0];
        setSelectedId(first?.id ?? null);
        setSession(null);
        setRunIndex(0);
        setProblem(
          update.sessions.length === 0
            ? `No Railtracks runs found in ${target.label}. Pick the project folder, .railtracks, or its data folder.`
            : null,
        );
        if (first) await openSession(target, first.id, false);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not read that folder.');
      }
    },
    [openSession],
  );

  const openHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      if (!(await ensureReadAccess(handle))) {
        setProblem(`Read access to ${handle.name} was not granted.`);
        return;
      }
      void rememberFolder(handle);
      setRemembered(handle);
      await showFolder(new FolderSource({ label: handle.name, handle }));
    },
    [showFolder],
  );

  const openFiles = useCallback(
    async (files: readonly File[], label: string) => {
      const [only] = files;
      if (files.length === 1 && only) showSingle(await only.text(), only.name);
      else if (files.length > 1) await showFolder(new FolderSource({ label, files }));
    },
    [showFolder, showSingle],
  );

  const chooseFolder = useCallback(async () => {
    if (!canFolder) {
      folderInput.current?.click();
      return;
    }
    try {
      const handle = await pickDirectory();
      if (handle) await openHandle(handle);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not open that folder.');
    }
  }, [canFolder, openHandle]);

  const loadSample = useCallback(async () => {
    try {
      const response = await fetch(href(SAMPLE_PATH));
      if (!response.ok) throw new Error(`answered ${response.status}`);
      showSingle(await response.text(), 'sample-run.jsonl');
    } catch {
      setProblem('The sample run could not be loaded.');
    }
  }, [showSingle]);

  const close = useCallback(() => {
    setSource(null);
    setSessions([]);
    setSelectedId(null);
    setSession(null);
    setProblem(null);
  }, []);

  /* ── Watching the folder ── */
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    if (!folder?.live) return;
    return folder.watch(
      (update: FolderUpdate) => {
        setSessions(update.sessions);
        const newest = update.sessions.find((s) => update.added.includes(s.id));
        if (followRef.current && newest) {
          setSelectedId(newest.id);
          void openSession(folder, newest.id, false);
        } else if (selectedRef.current && update.changed.includes(selectedRef.current)) {
          void openSession(folder, selectedRef.current, true);
        }
      },
      (error) => setProblem(error instanceof Error ? error.message : 'Lost access to the folder.'),
    );
  }, [folder, openSession]);

  // A different visualizer line may prefer the other file of the pair.
  useEffect(() => {
    if (folder && selectedRef.current) void openSession(folder, selectedRef.current, true);
  }, [folder, openSession]);

  /* ── Paste and drop ── */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTyping(event.target)) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      showSingle(text, 'pasted run');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [showSingle]);

  const onDragEnter = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void readDrop(event.dataTransfer).then(async ({ folder: dropped, files }) => {
      if (dropped) await openHandle(dropped);
      else await openFiles(files, 'dropped files');
    });
  };

  /* ── Controls ── */
  const onRailtracks = (version: string): void => {
    setRailtracks(version);
    if (!version || !catalog) return;
    const match = visualizerForRailtracks(catalog, version);
    if (match) setChoice(match.version);
  };
  const onChoice = (next: VisualizerChoice): void => {
    setChoice(next);
    setRailtracks('');
  };
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  };
  const selectSession = (id: string): void => {
    setSelectedId(id);
    if (folder) void openSession(folder, id, false);
  };

  const run = session?.runs[Math.min(runIndex, session.runs.length - 1)];
  const frameKey = resolvedVersion ?? 'none';

  const statusBadge =
    !resolved || frame.phase === 'loading' ? (
      <Badge tone="busy">Loading visualizer{resolved ? ` ${resolved.version}` : ''}</Badge>
    ) : frame.phase === 'error' ? (
      <Badge tone="alert">Visualizer failed</Badge>
    ) : (
      <Badge tone="ok">
        Visualizer {frame.version} · {(frame.ms / 1000).toFixed(1)} s
      </Badge>
    );

  return (
    <div
      ref={rootRef}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative ${fullscreen ? 'flex h-full flex-col overflow-auto bg-[var(--c-ground)] p-3' : ''}`}
    >
      <input
        ref={fileInput}
        type="file"
        accept=".json,.jsonl,application/json"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void openFiles(files, 'selected files');
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...{ webkitdirectory: '', directory: '' }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          const top = files[0]?.webkitRelativePath.split('/')[0] ?? 'folder';
          if (files.length) void showFolder(new FolderSource({ label: top, files }));
        }}
      />

      <Panel
        title="Run viewer"
        aside={statusBadge}
        className={fullscreen ? 'flex min-h-0 flex-1 flex-col' : ''}
      >
        {/* Versions and style */}
        <div className="grid gap-x-6 gap-y-4 border-b border-[var(--c-line)] p-4 xl:grid-cols-[minmax(0,1fr)_auto]">
          <VersionControls
            catalog={catalog}
            catalogError={catalogError}
            choice={choice}
            railtracks={railtracks}
            resolved={resolved}
            onChoice={onChoice}
            onRailtracks={onRailtracks}
          />
          <div className="flex flex-wrap items-start gap-x-5 gap-y-3 xl:justify-end">
            <div>
              <span className="eyebrow mb-1.5 block text-[10px] text-[var(--c-text-muted)]">
                Style
              </span>
              <Segmented<Skin>
                label="Graph style"
                value={skin}
                onChange={setSkin}
                options={[
                  { value: 'site', label: 'Site', title: 'Drawn in this site’s palette and type' },
                  { value: 'original', label: 'Original', title: 'As the visualizer ships' },
                ]}
              />
            </div>
            <div>
              <span className="eyebrow mb-1.5 block text-[10px] text-[var(--c-text-muted)]">
                Tone
              </span>
              <Segmented<ToneChoice>
                label="Light or dark"
                value={toneChoice}
                onChange={setToneChoice}
                options={[
                  { value: 'auto', label: 'Auto', title: 'Follow this page' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Source bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--c-line)] bg-[var(--c-raised)]/40 px-4 py-2.5">
          <Button variant={source ? 'ghost' : 'primary'} onClick={() => fileInput.current?.click()}>
            Open file
          </Button>
          <Button onClick={() => void chooseFolder()}>Open folder</Button>
          {remembered && folder?.handle !== remembered && (
            <Button variant="quiet" onClick={() => void openHandle(remembered)}>
              Reopen {remembered.name}
            </Button>
          )}

          {source && (
            <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-[var(--c-text-muted)] sm:ml-2 sm:border-l sm:border-[var(--c-line)] sm:pl-4">
              <span className="truncate text-[var(--c-text)]">
                {source.kind === 'file' ? source.label : `${source.folder.label}/`}
              </span>
              {source.kind === 'folder' ? (
                <Badge tone={source.folder.live ? 'ok' : 'idle'}>
                  {source.folder.watchMode === 'observer'
                    ? 'watching'
                    : source.folder.watchMode === 'polling'
                      ? 'watching · 2 s'
                      : 'snapshot'}
                </Badge>
              ) : (
                session && <SourceBadge session={session} />
              )}
              <button
                type="button"
                onClick={close}
                title="Close"
                aria-label="Close this source"
                className="rounded-sm px-1.5 text-[var(--c-text-faint)] hover:bg-[var(--c-raised)] hover:text-[var(--c-text)]"
              >
                ×
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {mounted && !source && (
              <span className="hidden font-mono text-[10.5px] text-[var(--c-text-faint)] md:inline">
                Drop or paste a run anywhere on this panel
              </span>
            )}
            <Button variant="quiet" onClick={toggleFullscreen} title="Fill the screen">
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </Button>
          </div>
        </div>

        {problem && (
          <div className="border-b border-[var(--c-line)] p-3">
            <ErrorNote>{problem}</ErrorNote>
          </div>
        )}
        {frame.phase === 'error' && (
          <div className="border-b border-[var(--c-line)] p-3">
            <ErrorNote>
              Visualizer {resolved?.version} could not load: {frame.message}. Pick another version
              above; older builds may not load outside their original app.
            </ErrorNote>
          </div>
        )}

        {/* Sessions and stage */}
        <div
          className={`grid min-h-0 ${
            folder ? 'lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]' : ''
          } ${fullscreen ? 'flex-1' : folder ? 'lg:h-[clamp(30rem,72vh,52rem)]' : ''}`}
        >
          {folder && (
            <aside className="flex h-80 min-h-0 flex-col border-b border-[var(--c-line)] lg:h-auto lg:border-r lg:border-b-0">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--c-line)] px-3 py-2">
                <span className="eyebrow text-[10px] text-[var(--c-text-muted)]">
                  {sessions.length} sessions
                </span>
                {folder.live && (
                  <Toggle
                    id="rv-follow"
                    label="Follow new runs"
                    checked={follow}
                    onChange={setFollow}
                    title="Open each new session as it appears"
                  />
                )}
              </div>
              <SessionList
                sessions={sessions}
                selectedId={selectedId}
                onSelect={selectSession}
                now={now}
              />
            </aside>
          )}

          <div className="flex min-h-0 min-w-0 flex-col">
            {session && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--c-line)] px-4 py-2">
                <StatusDot status={session.status} />
                <span className="min-w-0 truncate text-[13px] font-semibold">{session.name}</span>
                <span className="font-mono text-[10.5px] text-[var(--c-text-faint)]">
                  {session.id.slice(0, 8)}
                  {session.startTime ? ` · ${timeAgo(session.startTime * 1000, now)}` : ''}
                </span>
                {session.runs.length > 1 && (
                  <div className="ml-auto">
                    <Segmented<string>
                      label="Run in this session"
                      value={String(Math.min(runIndex, session.runs.length - 1))}
                      onChange={(v) => setRunIndex(Number(v))}
                      options={session.runs.map((r, i) => ({
                        value: String(i),
                        label: `${i + 1} · ${r.name}`,
                        title: `${r.status}, ${r.nodes.length} nodes`,
                      }))}
                    />
                  </div>
                )}
              </div>
            )}

            <div
              className={`relative min-h-0 ${
                fullscreen
                  ? 'flex-1'
                  : folder
                    ? 'h-[clamp(26rem,62vh,40rem)] lg:h-auto lg:flex-1'
                    : 'h-[clamp(28rem,68vh,50rem)]'
              } bg-[var(--c-sunken)]`}
            >
              {resolved && (
                <iframe
                  key={frameKey}
                  ref={frameRef}
                  src={href(FRAME_PATH)}
                  title="Railtracks visualizer"
                  sandbox="allow-scripts allow-popups"
                  referrerPolicy="no-referrer"
                  className={`absolute inset-0 h-full w-full border-0 ${
                    session && session.runs.length > 0 ? '' : 'invisible'
                  }`}
                />
              )}

              {!session && (
                <EmptyStage
                  canPickFolder={canFolder}
                  onFile={() => fileInput.current?.click()}
                  onFolder={() => void chooseFolder()}
                  onSample={() => void loadSample()}
                  reopen={
                    remembered && !folder
                      ? { name: remembered.name, onClick: () => void openHandle(remembered) }
                      : null
                  }
                />
              )}

              {session && session.runs.length === 0 && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-[11.5px] text-[var(--c-text-faint)]">
                  This session has no runs yet. If it is still going, they appear as it writes them.
                </div>
              )}

              {session && session.runs.length > 0 && frame.phase === 'loading' && (
                <div className="absolute inset-0 grid place-items-center bg-[var(--c-sunken)]/80 backdrop-blur-xs">
                  <span className="font-mono text-[11.5px] text-[var(--c-text-muted)]">
                    <span className="mr-2 inline-block size-1.5 animate-pulse bg-[var(--c-accent-fill)] align-middle" />
                    Fetching visualizer {resolved?.version} from npm
                  </span>
                </div>
              )}

              {dragging && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center border-2 border-dashed border-[var(--c-accent-fill)] bg-[var(--c-surface)]/85 backdrop-blur-xs">
                  <span className="font-mono text-xs font-bold text-[var(--c-accent)]">
                    Drop a run file, or a folder of them
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {session && run && <RunReadout run={run} />}
      </Panel>
    </div>
  );
}
