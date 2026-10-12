/**
 * A folder of Railtracks runs, read from disk and watched for new ones.
 *
 * Three ways in, best first:
 *
 * 1. **A directory handle** (File System Access API: `showDirectoryPicker`,
 *    or a folder dragged onto the page in Chromium). Read on demand, so files
 *    are always current, and watched: with `FileSystemObserver` where the
 *    browser has it (Chromium 133+), otherwise by re-listing every couple of
 *    seconds. Nothing is uploaded; the browser hands the page read access to
 *    that one folder, and only after the visitor picks it.
 * 2. **A file list** from `<input webkitdirectory>` or a multi-file drop, in
 *    browsers without directory handles. A snapshot: it cannot see new runs.
 *
 * Any folder works as the starting point. The project root, `.railtracks`,
 * `.railtracks/data`, or `sessions` or `events` themselves: the walk finds
 * session files (`sessions/*.json`) and event streams (`events/*.jsonl`) and
 * pairs the two files a session can have by the id in their names.
 */

import { flowNameFromName, parseRunText, sessionIdFromName, type LoadedSession } from './runs';
import type { SessionStatus } from './runs';

/* ── Browser APIs not in TypeScript's DOM types yet ──────────────────── */

type PermissionMode = { mode: 'read' | 'readwrite' };

interface PermissionedHandle {
  queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
}

interface FileSystemObserverLike {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}

type FileSystemObserverCtor = new (
  callback: (records: unknown[]) => void,
) => FileSystemObserverLike;

interface PickerWindow {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
  FileSystemObserver?: FileSystemObserverCtor;
}

const pickerWindow = (): PickerWindow => window as unknown as PickerWindow;

/** True where the page can be handed a live folder (Chromium browsers). */
export function canPickDirectory(): boolean {
  return typeof window !== 'undefined' && typeof pickerWindow().showDirectoryPicker === 'function';
}

/** True where a picked folder can be watched without polling. */
export function canObserveFiles(): boolean {
  return typeof window !== 'undefined' && typeof pickerWindow().FileSystemObserver === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const pick = pickerWindow().showDirectoryPicker;
  if (!pick) return null;
  try {
    return await pick({ id: 'railtracks-runs', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

/** Ask again for read access to a remembered folder. Needs a click to have just happened. */
export async function ensureReadAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const permissioned = handle as unknown as PermissionedHandle;
  if (!permissioned.queryPermission || !permissioned.requestPermission) return true;
  if ((await permissioned.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await permissioned.requestPermission({ mode: 'read' })) === 'granted';
}

/* ── What the folder holds ───────────────────────────────────────────── */

export type RunFileKind = 'session' | 'events';

export interface RunFile {
  /** Path from the picked folder, used as the key. */
  path: string;
  name: string;
  kind: RunFileKind;
  size: number;
  lastModified: number;
  read: () => Promise<File>;
}

export interface FolderSession {
  id: string;
  /** Flow name, from the file name or the first event; null until known. */
  name: string | null;
  session?: RunFile;
  events?: RunFile;
  /** Newest change to either file, in ms. */
  lastModified: number;
  /**
   * Size and time of both files. A change to either means the session
   * changed: an append does not always move the modified time (the browser's
   * private file system keeps it), but it always moves the size.
   */
  stamp: string;
  /** From a cheap peek at the files, before they are opened. */
  status: SessionStatus;
  /** Unix seconds, when the peek found it. */
  startTime: number | null;
}

/** A change set: the full list now, and which sessions are new or changed. */
export interface FolderUpdate {
  sessions: FolderSession[];
  added: string[];
  changed: string[];
}

/** Folders that never hold run logs and can be huge. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'site-packages',
  'dist',
  'build',
  '.next',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
]);
const MAX_DEPTH = 4;
const MAX_DIRS = 400;
/** A run still being written has an event file modified this recently. */
const LIVE_WINDOW_MS = 90_000;
const POLL_MS = 2_000;

function kindFor(name: string, parent: string): RunFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jsonl')) return 'events';
  if (lower.endsWith('.json') && (parent === 'sessions' || sessionIdFromName(lower)))
    return 'session';
  return null;
}

/* ── Listing ─────────────────────────────────────────────────────────── */

interface Listing {
  files: RunFile[];
  /** The folders run files were found in, for watching. */
  dirs: FileSystemDirectoryHandle[];
}

async function listHandle(root: FileSystemDirectoryHandle): Promise<Listing> {
  const files: RunFile[] = [];
  const dirs = new Set<FileSystemDirectoryHandle>();
  let visited = 0;

  async function walk(dir: FileSystemDirectoryHandle, path: string, depth: number): Promise<void> {
    visited += 1;
    if (visited > MAX_DIRS) return;
    const subdirs: Array<[FileSystemDirectoryHandle, string]> = [];
    for await (const entry of dir.values()) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) {
          subdirs.push([entry as FileSystemDirectoryHandle, entryPath]);
        }
        continue;
      }
      const kind = kindFor(entry.name, dir.name);
      if (!kind) continue;
      const handle = entry as FileSystemFileHandle;
      const file = await handle.getFile();
      files.push({
        path: entryPath,
        name: entry.name,
        kind,
        size: file.size,
        lastModified: file.lastModified,
        read: () => handle.getFile(),
      });
      dirs.add(dir);
    }
    // Run folders first, so a big project still reaches `.railtracks` in budget.
    subdirs.sort(([a], [b]) => rank(a.name) - rank(b.name));
    for (const [sub, subPath] of subdirs) await walk(sub, subPath, depth + 1);
  }

  await walk(root, '', 0);
  return { files: onlyRunFolders(files), dirs: [...dirs] };
}

function rank(name: string): number {
  if (name === '.railtracks' || name === 'data') return 0;
  if (name === 'sessions' || name === 'events') return 1;
  return 2;
}

/**
 * When a folder has proper `sessions/` or `events/` folders, stray JSON
 * elsewhere (a `package.json`, a fixture) is not a run.
 */
function onlyRunFolders(files: RunFile[]): RunFile[] {
  const inRunFolder = (file: RunFile): boolean => /(^|\/)(sessions|events)\/[^/]+$/.test(file.path);
  return files.some(inRunFolder) ? files.filter(inRunFolder) : files;
}

function listFileList(list: readonly File[]): Listing {
  const files: RunFile[] = [];
  for (const file of list) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = path.split('/');
    if (parts.some((part) => SKIP_DIRS.has(part))) continue;
    const kind = kindFor(file.name, parts.at(-2) ?? '');
    if (!kind) continue;
    files.push({
      path,
      name: file.name,
      kind,
      size: file.size,
      lastModified: file.lastModified,
      read: () => Promise.resolve(file),
    });
  }
  return { files: onlyRunFolders(files), dirs: [] };
}

/* ── Peeking without opening the whole file ──────────────────────────── */

interface Peek {
  name: string | null;
  status: SessionStatus;
  startTime: number | null;
}

const PEEK_BYTES = 16_384;

async function peekEvents(file: RunFile): Promise<Peek> {
  const blob = await file.read();
  const head = await blob.slice(0, Math.min(blob.size, PEEK_BYTES)).text();
  const tail = await blob.slice(Math.max(0, blob.size - PEEK_BYTES)).text();
  let name: string | null = null;
  let startTime: number | null = null;
  const first = head.split('\n', 1)[0] ?? '';
  try {
    const event = JSON.parse(first) as { event_type?: string; payload?: Record<string, unknown> };
    if (event.event_type === 'session.started') {
      const p = event.payload ?? {};
      name =
        (typeof p.flow_name === 'string' && p.flow_name) ||
        (typeof p.entry_point_name === 'string' && p.entry_point_name) ||
        null;
      const ms = typeof p.timestamp === 'string' ? Date.parse(p.timestamp) : Number.NaN;
      startTime = Number.isNaN(ms) ? null : ms / 1000;
    }
  } catch {
    /* a first line longer than the peek; the name waits for a full read */
  }
  let status: SessionStatus =
    Date.now() - file.lastModified < LIVE_WINDOW_MS ? 'running' : 'unknown';
  const completed = /"event_type":\s*"session\.completed".*?"status":\s*"([^"]+)"/.exec(tail);
  if (completed?.[1]) status = /fail|error/i.test(completed[1]) ? 'failed' : 'completed';
  return { name, status, startTime };
}

async function peekSession(file: RunFile): Promise<Peek> {
  const name = flowNameFromName(file.name);
  if (file.size > 4_000_000) return { name, status: 'unknown', startTime: null };
  try {
    const session = parseRunText(await (await file.read()).text(), file.name);
    return { name: name ?? session.name, status: session.status, startTime: session.startTime };
  } catch {
    return { name, status: 'unknown', startTime: null };
  }
}

/* ── The source ──────────────────────────────────────────────────────── */

export interface FolderSourceInit {
  /** Shown in the UI: the picked folder's name. */
  label: string;
  handle?: FileSystemDirectoryHandle;
  files?: readonly File[];
}

/**
 * One opened folder. `scan` lists it, `watch` keeps listing it, `open` reads
 * one session. Peeks are cached by path, size and modified time, so a re-scan
 * of 400 sessions only reads the files that changed.
 */
export class FolderSource {
  readonly label: string;
  readonly handle: FileSystemDirectoryHandle | null;
  private readonly fileList: readonly File[] | null;
  private sessions = new Map<string, FolderSession>();
  private peeks = new Map<string, { stamp: string; peek: Peek }>();
  private dirs: FileSystemDirectoryHandle[] = [];

  constructor(init: FolderSourceInit) {
    this.label = init.label;
    this.handle = init.handle ?? null;
    this.fileList = init.files ?? null;
  }

  /** True when new runs can appear: a live handle rather than a snapshot. */
  get live(): boolean {
    return this.handle !== null;
  }

  /** How changes are noticed, for the UI to say. */
  get watchMode(): 'observer' | 'polling' | 'snapshot' {
    if (!this.handle) return 'snapshot';
    return canObserveFiles() ? 'observer' : 'polling';
  }

  async scan(): Promise<FolderUpdate> {
    const listing = this.handle ? await listHandle(this.handle) : listFileList(this.fileList ?? []);
    this.dirs = listing.dirs;

    const next = new Map<string, FolderSession>();
    for (const file of listing.files) {
      const id = sessionIdFromName(file.name) ?? file.path;
      const entry: FolderSession = next.get(id) ?? {
        id,
        name: null,
        lastModified: 0,
        stamp: '',
        status: 'unknown',
        startTime: null,
      };
      entry[file.kind] = file;
      entry.lastModified = Math.max(entry.lastModified, file.lastModified);
      entry.stamp += `${file.kind}:${file.size}:${file.lastModified};`;
      next.set(id, entry);
    }

    const added: string[] = [];
    const changed: string[] = [];
    await Promise.all(
      [...next.values()].map(async (entry) => {
        const before = this.sessions.get(entry.id);
        if (!before) added.push(entry.id);
        else if (before.stamp !== entry.stamp) changed.push(entry.id);
        const peek = await this.peek(entry);
        entry.name = peek.name;
        entry.status = peek.status;
        entry.startTime = peek.startTime;
      }),
    );
    this.sessions = next;
    const sessions = [...next.values()].sort((a, b) => b.lastModified - a.lastModified);
    return { sessions, added, changed };
  }

  private async peek(entry: FolderSession): Promise<Peek> {
    // The event stream is the newer format and says whether the run finished.
    const file = entry.events ?? entry.session!;
    const stamp = `${file.size}:${file.lastModified}`;
    const cached = this.peeks.get(file.path);
    // A "running" peek is re-checked even unchanged: it goes stale by time alone.
    if (cached && cached.stamp === stamp && cached.peek.status !== 'running') return cached.peek;
    const peek = file.kind === 'events' ? await peekEvents(file) : await peekSession(file);
    if (!peek.name && entry.session) peek.name = flowNameFromName(entry.session.name);
    this.peeks.set(file.path, { stamp, peek });
    return peek;
  }

  /**
   * Read one session. `prefer` picks which file when it has both: the session
   * file is the exact record for the V1 visualizer, the event stream is the
   * only one that exists while a run is going and the one V2 reads.
   */
  async open(id: string, prefer: RunFileKind = 'session'): Promise<LoadedSession> {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error('That session is no longer in the folder.');
    // A run still being written has no session file yet, or a stale one.
    const order: RunFileKind[] =
      prefer === 'session' && entry.status !== 'running'
        ? ['session', 'events']
        : ['events', 'session'];
    let lastError: unknown = null;
    for (const kind of order) {
      const file = entry[kind];
      if (!file) continue;
      try {
        return parseRunText(await (await file.read()).text(), file.name);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not read this session.');
  }

  /**
   * Re-scan whenever the folder changes. Returns a stop function. With
   * `FileSystemObserver` the run folders found by the last scan are observed
   * (plus the picked folder, so a `sessions/` created later is noticed);
   * without it, the folder is re-listed every two seconds.
   */
  watch(onUpdate: (update: FolderUpdate) => void, onError: (error: unknown) => void): () => void {
    if (!this.handle) return () => undefined;
    let stopped = false;
    let pending: number | undefined;
    let running = false;

    const rescan = async (): Promise<void> => {
      if (stopped || running) return;
      running = true;
      try {
        const update = await this.scan();
        if (!stopped && (update.added.length || update.changed.length)) onUpdate(update);
      } catch (error) {
        if (!stopped) onError(error);
      } finally {
        running = false;
      }
    };

    const Observer = pickerWindow().FileSystemObserver;
    if (Observer) {
      const observer = new Observer(() => {
        window.clearTimeout(pending);
        pending = window.setTimeout(() => void rescan(), 250);
      });
      const targets = new Set<FileSystemDirectoryHandle>([this.handle, ...this.dirs]);
      void Promise.all([...targets].map((dir) => observer.observe(dir))).catch(onError);
      // Running sessions age into "unknown" without a file event; check them now and then.
      const ticker = window.setInterval(() => void rescan(), LIVE_WINDOW_MS / 3);
      return () => {
        stopped = true;
        window.clearTimeout(pending);
        window.clearInterval(ticker);
        observer.disconnect();
      };
    }

    const timer = window.setInterval(() => void rescan(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }
}

/* ── Remembering the folder ──────────────────────────────────────────── */

const DB_NAME = 'coronring-run-viewer';
const STORE = 'folders';
const KEY = 'last';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Keep the handle so the next visit can offer to reopen the folder. A handle
 * in IndexedDB is not access: the browser asks again before it can be read.
 */
export async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* storage blocked; the folder just is not remembered */
  }
}

export async function recallFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle instanceof FileSystemDirectoryHandle ? handle : null;
  } catch {
    return null;
  }
}

export async function forgetFolder(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* nothing to forget */
  }
}

/* ── Drops ───────────────────────────────────────────────────────────── */

interface HandleItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

/**
 * What a drop carried: a live folder where the browser offers one, else the
 * dropped files (folders expanded where `webkitGetAsEntry` allows).
 */
export async function readDrop(
  transfer: DataTransfer,
): Promise<{ folder: FileSystemDirectoryHandle | null; files: File[] }> {
  const items = [...transfer.items].filter((item) => item.kind === 'file');

  // Ask for handles first: the items are only readable during the drop event's task.
  const handleRequests = items.map(
    (item) => (item as unknown as HandleItem).getAsFileSystemHandle?.() ?? Promise.resolve(null),
  );
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
  const plain = [...transfer.files];

  const handles = await Promise.all(handleRequests.map((p) => p.catch(() => null)));
  const folder = handles.find((h): h is FileSystemDirectoryHandle => h?.kind === 'directory');
  if (folder) return { folder, files: [] };

  if (entries.some((entry) => entry?.isDirectory)) {
    const files: File[] = [];
    await Promise.all(entries.map((entry) => (entry ? collect(entry, files, 0) : null)));
    return { folder: null, files };
  }
  return { folder: null, files: plain };
}

async function collect(entry: FileSystemEntry, out: File[], depth: number): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    // Keep the folder path, so `sessions/` and `events/` are recognised.
    Object.defineProperty(file, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') });
    out.push(file);
    return;
  }
  if (depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    children.push(...batch);
  }
  await Promise.all(children.map((child) => collect(child, out, depth + 1)));
}
