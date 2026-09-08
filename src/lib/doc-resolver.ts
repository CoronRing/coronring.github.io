/**
 * Document & Source URL Resolver.
 *
 * Normalises arbitrary document inputs (GitHub blob URLs, raw URLs, shorthand
 * repository paths, camo proxies, general web URLs, and local paths) into clean
 * fetch URLs and identifies content kinds.
 */

export type DocKind = 'markdown' | 'html' | 'video' | 'audio' | 'image' | 'pdf' | 'code' | 'text';

export interface ResolvedDoc {
  /** Clean URL used by the browser to fetch the raw content / media stream. */
  rawUrl: string;
  /** Canonical display source (e.g. GitHub web page link or external website). */
  sourceUrl: string;
  /** Human-readable filename (e.g. `AGENTS.md` or `logo.svg`). */
  fileName: string;
  /** File extension in lowercase, including leading dot (e.g. `.md`, `.svg`). */
  extension: string;
  /** Inferred document kind for renderer dispatch. */
  kind: DocKind;
  /** True if source originates from a GitHub repository. */
  isGitHub: boolean;
  /** Repository identifier if GitHub (e.g. `RailtownAI/railtracks`). */
  repo?: string;
  /** Git branch or commit ref if GitHub (e.g. `main`). */
  branch?: string;
  /** Path inside repository (e.g. `docs/AGENTS.md`). */
  repoPath?: string;
  /** Link to browse the repository home page on GitHub. */
  repoUrl?: string;
  /** Base directory URL for resolving relative links/images. */
  baseUrl: string;
}

const EXT_TO_KIND: Record<string, DocKind> = {
  // Markdown
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.mdown': 'markdown',
  '.mkdn': 'markdown',

  // HTML
  '.html': 'html',
  '.htm': 'html',

  // Video
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.ogg': 'video',
  '.m4v': 'video',

  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.flac': 'audio',

  // Images
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.ico': 'image',

  // PDF
  '.pdf': 'pdf',

  // Code / Structured
  '.py': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.jsx': 'code',
  '.json': 'code',
  '.yaml': 'code',
  '.yml': 'code',
  '.toml': 'code',
  '.sh': 'code',
  '.bash': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.sql': 'code',
  '.rs': 'code',
  '.go': 'code',
  '.java': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.csv': 'code',
  '.tsv': 'code',
  '.xml': 'code',
  '.env': 'code',
  '.ini': 'code',
  '.dockerfile': 'code',

  // Plain text
  '.txt': 'text',
  '.text': 'text',
  '.log': 'text',
};

/**
 * Decodes hex-encoded target URLs inside Camo proxies (e.g. pypi-camo or github camo).
 */
export function decodeCamoHex(input: string): string | null {
  try {
    const match = input.match(/\/([a-fA-F0-9]{32,64})\/([a-fA-F0-9]{16,})/);
    if (!match || !match[2]) return null;
    const hex = match[2];
    let decoded = decodeURIComponent(hex.replace(/\s+/g, '').replace(/[0-9a-fA-F]{2}/g, '%$&'));
    // Auto-heal typo in railtracks storage camo URLs
    if (decoded.includes('railtrcks')) {
      decoded = decoded.replace(/railtrcks/gi, 'railtracks');
    }
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // Non-hex or invalid URI sequence
  }
  return null;
}

/**
 * Extracts the file extension from a path or URL string (ignoring query strings and hashes).
 */
export function getExtension(input: string): string {
  try {
    const clean = input.split(/[?#]/)[0] ?? '';
    const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot > 0) {
      return fileName.slice(lastDot).toLowerCase();
    }
    // Dockerfile / Makefile special case
    if (/^dockerfile$/i.test(fileName) || /^makefile$/i.test(fileName)) {
      return '.txt';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Derives a clean filename from a path or URL.
 */
export function getFileName(input: string): string {
  try {
    const clean = input.split(/[?#]/)[0] ?? '';
    const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    const segment = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
    return decodeURIComponent(segment) || 'document';
  } catch {
    return 'document';
  }
}

/**
 * Normalises any input document string into a `ResolvedDoc`.
 *
 * Supported inputs:
 * 1. GitHub blob: `https://github.com/RailtownAI/railtracks/blob/main/AGENTS.md`
 * 2. Raw GitHub: `https://raw.githubusercontent.com/RailtownAI/railtracks/main/AGENTS.html`
 * 3. Shorthand path: `/RailtownAI/railtracks/main/AGENTS.mp4` or `RailtownAI/railtracks/blob/main/AGENTS.md`
 * 4. Camo proxy URL: `https://pypi-camo.freetls.fastly.net/...`
 * 5. General web URL: `https://example.com/file.md` or `https://.../image.svg`
 * 6. Local site doc: `/docs/demo.md` or `demo.md`
 */
export function resolveDocSource(rawInput: string, siteOrigin = ''): ResolvedDoc | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. GitHub Web UI blob URL: https://github.com/:owner/:repo/blob/:branch/:filePath...
  const githubBlobMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
  );
  if (githubBlobMatch) {
    const [, owner = '', repoName = '', branch = '', repoPath = ''] = githubBlobMatch;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${repoPath}`;
    const ext = getExtension(repoPath);
    const fileName = getFileName(repoPath);
    const baseUrl = rawUrl.slice(0, rawUrl.lastIndexOf('/') + 1);

    return {
      rawUrl,
      sourceUrl: trimmed,
      fileName,
      extension: ext,
      kind: EXT_TO_KIND[ext] ?? 'markdown',
      isGitHub: true,
      repo: `${owner}/${repoName}`,
      branch,
      repoPath,
      repoUrl: `https://github.com/${owner}/${repoName}`,
      baseUrl,
    };
  }

  // 2. Raw GitHub URL: https://raw.githubusercontent.com/:owner/:repo/:branch/:filePath...
  const githubRawMatch = trimmed.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
  );
  if (githubRawMatch) {
    const [, owner = '', repoName = '', branch = '', repoPath = ''] = githubRawMatch;
    const sourceUrl = `https://github.com/${owner}/${repoName}/blob/${branch}/${repoPath}`;
    const ext = getExtension(repoPath);
    const fileName = getFileName(repoPath);
    const baseUrl = trimmed.slice(0, trimmed.lastIndexOf('/') + 1);

    return {
      rawUrl: trimmed,
      sourceUrl,
      fileName,
      extension: ext,
      kind: EXT_TO_KIND[ext] ?? 'markdown',
      isGitHub: true,
      repo: `${owner}/${repoName}`,
      branch,
      repoPath,
      repoUrl: `https://github.com/${owner}/${repoName}`,
      baseUrl,
    };
  }

  // 3. Camo Proxy URLs (e.g. pypi-camo, github camo)
  const decodedCamo = decodeCamoHex(trimmed);
  if (decodedCamo) {
    const ext = getExtension(decodedCamo);
    const fileName = getFileName(decodedCamo);
    const baseUrl = decodedCamo.slice(0, decodedCamo.lastIndexOf('/') + 1);
    const kind = EXT_TO_KIND[ext] ?? 'image';

    return {
      rawUrl: decodedCamo,
      sourceUrl: trimmed,
      fileName,
      extension: ext,
      kind,
      isGitHub: false,
      baseUrl,
    };
  }

  // 4. Shorthand GitHub path: /RailtownAI/railtracks/main/AGENTS.mp4 or RailtownAI/railtracks/blob/main/AGENTS.md
  // Defaults to GitHub when no scheme is provided
  const normalizedShorthand = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const shorthandMatch = normalizedShorthand.match(
    /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/(?:blob\/)?([^/]+)\/(.+))?$/,
  );

  const firstSeg = shorthandMatch?.[1]?.toLowerCase() ?? '';
  const isShorthandRepo =
    shorthandMatch &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    firstSeg !== 'docs' &&
    firstSeg !== 'public' &&
    !firstSeg.includes('.'); // Not a domain name like example.com/file

  if (isShorthandRepo && shorthandMatch) {
    const [, owner = '', repoName = '', branch = 'main', repoPath = 'README.md'] = shorthandMatch;
    const cleanBranch = branch || 'main';
    const cleanRepoPath = repoPath || 'README.md';
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${cleanBranch}/${cleanRepoPath}`;
    const sourceUrl = `https://github.com/${owner}/${repoName}/blob/${cleanBranch}/${cleanRepoPath}`;
    const ext = getExtension(cleanRepoPath);
    const fileName = getFileName(cleanRepoPath);
    const baseUrl = rawUrl.slice(0, rawUrl.lastIndexOf('/') + 1);

    return {
      rawUrl,
      sourceUrl,
      fileName,
      extension: ext,
      kind: EXT_TO_KIND[ext] ?? 'markdown',
      isGitHub: true,
      repo: `${owner}/${repoName}`,
      branch: cleanBranch,
      repoPath: cleanRepoPath,
      repoUrl: `https://github.com/${owner}/${repoName}`,
      baseUrl,
    };
  }

  // 5. Local site doc path (e.g. /docs/demo.md or docs/manual.md or demo_old.md)
  const isLocal =
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    (!trimmed.includes('://') && !trimmed.includes('/'));

  if (isLocal) {
    let localPath = trimmed;
    if (!localPath.startsWith('/') && !localPath.startsWith('./')) {
      localPath = `/docs/${localPath}`;
    }
    const fullUrl = siteOrigin ? `${siteOrigin.replace(/\/$/, '')}${localPath}` : localPath;
    const ext = getExtension(localPath);
    const fileName = getFileName(localPath);
    const baseUrl = fullUrl.slice(0, fullUrl.lastIndexOf('/') + 1);

    return {
      rawUrl: fullUrl,
      sourceUrl: localPath,
      fileName,
      extension: ext,
      kind: EXT_TO_KIND[ext] ?? 'markdown',
      isGitHub: false,
      baseUrl,
    };
  }

  // 6. Generic absolute HTTP/HTTPS URL (General link from any domain)
  try {
    let parsed = trimmed;
    if (!parsed.startsWith('http://') && !parsed.startsWith('https://')) {
      parsed = `https://${parsed}`;
    }
    const urlObj = new URL(parsed);
    const ext = getExtension(urlObj.pathname);
    const fileName = getFileName(urlObj.pathname);
    const baseUrl = parsed.slice(0, parsed.lastIndexOf('/') + 1);

    return {
      rawUrl: parsed,
      sourceUrl: parsed,
      fileName,
      extension: ext,
      kind: EXT_TO_KIND[ext] ?? (ext ? 'text' : 'markdown'),
      isGitHub: false,
      baseUrl,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a relative asset (image/link) URL against a document base URL.
 * Leaves absolute URLs (http, https, data:, mailto:, #anchors) untouched.
 */
export function resolveRelativeUrl(target: string, baseUrl: string): string {
  if (!target || !baseUrl) return target;
  const trimmed = target.trim();
  if (/^(https?:\/\/|data:|mailto:|#)/i.test(trimmed) || trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}
