/**
 * The model price catalogue, and the loader that brings it into the page.
 *
 * ## Where the prices come from
 *
 * LiteLLM's published price list (`model_prices_and_context_window.json`), the
 * most complete public list for hosted language models: around 2,400
 * token-priced models across 80-odd providers. Providers change prices often
 * and LiteLLM tracks them daily, so the page reads the list **from its source
 * on every visit** rather than from a copy deployed with the site. A copy would
 * be stale by the next price change, and keeping it fresh would mean a site
 * deploy for every one.
 *
 * - **First choice:** `raw.githubusercontent.com`. It allows cross-origin reads,
 *   caches for five minutes, and sends the 2.8 MB file as about 145 kB gzipped.
 * - **Then:** the jsDelivr mirror of the same file, for networks that block
 *   GitHub's raw host. It can lag GitHub by up to 12 hours, and the UI says so.
 * - **Last:** the curated entries in `src/data/models.ts`, flagged incomplete.
 *
 * The request carries nothing but its own URL: no cookies, no referrer, and
 * never the visitor's text. The list is trimmed in the tab to the fields the
 * tool shows (`compactEntry`), so only ~2,400 small records stay in memory.
 *
 * ## Why there is still a hardcoded table
 *
 * `src/data/models.ts` carries a handful of curated entries. They serve two
 * purposes: they are the default comparison set (a catalogue of 2,400 rows is
 * useless as a starting position), and they are the fallback if both sources
 * fail. A tool that shows nothing when a fetch fails is worse than one that
 * shows four models and says so.
 *
 * ## Units
 *
 * Every price in this module is **USD per million tokens**, the unit vendors
 * publish. `src/lib/tokens.ts#costOf` expects the same, so the two compose
 * without a conversion step anyone can get wrong.
 */

import { MODELS, effectivePrice, type ModelInfo } from '../data/models';

/** Modes kept from the source. All are priced per token. */
export type ModelMode = 'chat' | 'completion' | 'responses' | 'embedding';

/** Capability flags, read from the source's `supports_*` fields. */
export interface ModelCapabilities {
  readonly tools: boolean;
  readonly vision: boolean;
  readonly reasoning: boolean;
  readonly caching: boolean;
  readonly schema: boolean;
  readonly pdf: boolean;
  readonly audio: boolean;
  readonly websearch: boolean;
  readonly computer: boolean;
}

export type CapabilityName = keyof ModelCapabilities;

/** One model, normalised for display. */
export interface PricedModel {
  readonly id: string;
  /** Display name — the id for catalogue entries, a friendly name for curated ones. */
  readonly name: string;
  readonly provider: string;
  readonly mode: ModelMode;
  /** Context window in tokens, where the provider publishes one. */
  readonly context?: number;
  readonly maxOutput?: number;
  /** USD per 1M input tokens. */
  readonly input: number;
  /** USD per 1M output tokens. Zero for embedding models. */
  readonly output: number;
  /** USD per 1M cached input tokens read. */
  readonly cacheRead?: number;
  /** USD per 1M tokens written to cache. */
  readonly cacheWrite?: number;
  /** ISO date the provider retires the model, if announced. */
  readonly deprecation?: string;
  readonly caps: ModelCapabilities;
  /** True for the hand-maintained entries — pinned to the top of the list. */
  readonly curated: boolean;
  /** Positioning line, curated entries only. */
  readonly note?: string;
}

/** Where the loaded prices came from. */
export type CatalogueOrigin = 'live' | 'mirror' | 'curated';

export interface PriceCatalogue {
  readonly models: readonly PricedModel[];
  readonly providers: readonly string[];
  /** ISO timestamp of the fetch; empty for the curated fallback. */
  readonly fetched: string;
  readonly source: string;
  readonly origin: CatalogueOrigin;
  /** False when both sources failed and only the curated fallback is present. */
  readonly complete: boolean;
}

/** The source list, first choice first: the same file on two hosts. */
const SOURCES: ReadonlyArray<{ readonly url: string; readonly origin: CatalogueOrigin }> = [
  {
    url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    origin: 'live',
  },
  {
    url: 'https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json',
    origin: 'mirror',
  },
];

/** A source gets this long before the next one is tried. */
const SOURCE_TIMEOUT_MS = 12_000;

/** Modes priced per token. Image and audio models price per image or per second. */
const KEPT_MODES = new Set<string>(['chat', 'completion', 'responses', 'embedding']);

/** Each capability and the source field that carries it. */
const CAPABILITY_FIELDS: ReadonlyArray<readonly [CapabilityName, string]> = [
  ['tools', 'supports_function_calling'],
  ['vision', 'supports_vision'],
  ['reasoning', 'supports_reasoning'],
  ['caching', 'supports_prompt_caching'],
  ['schema', 'supports_response_schema'],
  ['pdf', 'supports_pdf_input'],
  ['audio', 'supports_audio_input'],
  ['websearch', 'supports_web_search'],
  ['computer', 'supports_computer_use'],
];

const NO_CAPS: ModelCapabilities = {
  tools: false,
  vision: false,
  reasoning: false,
  caching: false,
  schema: false,
  pdf: false,
  audio: false,
  websearch: false,
  computer: false,
};

/** USD per token to USD per million tokens, rounded to drop float noise. */
function perMillion(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1e6 * 1e6) / 1e6;
}

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * One source entry as a catalogue row, or `null` when it cannot be costed from
 * a token count: a mode priced per image or second, or a chat model with no
 * input price (an incomplete entry, dropped rather than shown as free). An
 * embedding model legitimately has no output price.
 */
export function compactEntry(id: string, raw: unknown): PricedModel | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.mode !== 'string' || !KEPT_MODES.has(entry.mode)) return null;
  const input = perMillion(entry.input_cost_per_token);
  if (input === undefined) return null;

  const caps: Record<CapabilityName, boolean> = { ...NO_CAPS };
  for (const [name, field] of CAPABILITY_FIELDS) caps[name] = entry[field] === true;

  return {
    id,
    name: id,
    provider: typeof entry.litellm_provider === 'string' ? entry.litellm_provider : 'unknown',
    mode: entry.mode as ModelMode,
    context: positive(entry.max_input_tokens) ?? positive(entry.max_tokens),
    maxOutput: positive(entry.max_output_tokens),
    input,
    output: perMillion(entry.output_cost_per_token) ?? 0,
    cacheRead: perMillion(entry.cache_read_input_token_cost),
    cacheWrite: perMillion(entry.cache_creation_input_token_cost),
    deprecation: typeof entry.deprecation_date === 'string' ? entry.deprecation_date : undefined,
    caps,
    curated: false,
  };
}

/**
 * Curated entries as catalogue rows.
 *
 * Promotional pricing is resolved at call time via `effectivePrice`, so a
 * promotion that lapses stops being quoted without an edit here.
 */
function curatedModels(now: Date): PricedModel[] {
  return MODELS.map((model: ModelInfo): PricedModel => {
    const price = effectivePrice(model, now);
    return {
      id: model.id,
      name: model.name,
      provider: model.provider,
      mode: 'chat',
      context: model.context,
      input: price.input,
      output: price.output,
      caps: { ...NO_CAPS, tools: true, vision: true, caching: true, schema: true, reasoning: true },
      curated: true,
      note: model.note,
    };
  });
}

/** Ids shown by default, before the visitor picks anything. */
export const DEFAULT_SELECTION: readonly string[] = MODELS.map((m) => m.id);

/** The catalogue with only the curated entries — used when the fetch fails. */
export function fallbackCatalogue(now: Date = new Date()): PriceCatalogue {
  const models = curatedModels(now);
  return {
    models,
    providers: [...new Set(models.map((m) => m.provider))],
    fetched: '',
    source: '',
    origin: 'curated',
    complete: false,
  };
}

/**
 * One in-flight load per tab.
 *
 * Every consumer awaits the same promise, so a page with two islands that both
 * need prices still makes one request.
 */
let pending: Promise<PriceCatalogue> | null = null;

/**
 * Load the price catalogue.
 *
 * Never rejects: when both sources fail it resolves to
 * {@link fallbackCatalogue}, flagged `complete: false` so the UI can say what
 * the visitor is looking at.
 */
export function loadCatalogue(now: Date = new Date()): Promise<PriceCatalogue> {
  pending ??= fetchCatalogue(now).catch(() => fallbackCatalogue(now));
  return pending;
}

async function fetchCatalogue(now: Date): Promise<PriceCatalogue> {
  let lastError: unknown = new Error('No price source answered');
  for (const source of SOURCES) {
    try {
      const response = await fetch(source.url, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${new URL(source.url).host} answered ${response.status}`);
      const raw: unknown = await response.json();
      if (typeof raw !== 'object' || raw === null) throw new Error('Price list is malformed');
      return buildCatalogue(raw as Record<string, unknown>, source, now);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function buildCatalogue(
  raw: Record<string, unknown>,
  source: (typeof SOURCES)[number],
  now: Date,
): PriceCatalogue {
  const listed: PricedModel[] = [];
  for (const [id, entry] of Object.entries(raw)) {
    if (id === 'sample_spec') continue; // the source's documentation stub
    const model = compactEntry(id, entry);
    if (model) listed.push(model);
  }
  if (listed.length === 0) throw new Error('Price list has no token-priced models');
  listed.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  const listedById = new Map(listed.map((m) => [m.id, m]));

  /*
   * A curated entry keeps its display name, its note and its pinned position,
   * but the *numbers* come from the list where the list has them. The
   * hand-maintained table cannot carry cache rates or capability flags for
   * every model, and a pinned row missing its cache-read price would quietly
   * break the cache projection for exactly the models most people use.
   */
  const curated = curatedModels(now).map((model): PricedModel => {
    const twin = listedById.get(model.id);
    return twin ? { ...twin, name: model.name, note: model.note, curated: true } : model;
  });
  const curatedIds = new Set(curated.map((m) => m.id));
  const curatedProviders = [...new Set(curated.map((m) => m.provider))];
  const providers = [...new Set(listed.map((m) => m.provider))].sort();

  return {
    models: [...curated, ...listed.filter((m) => !curatedIds.has(m.id))],
    providers: [...curatedProviders, ...providers.filter((p) => !curatedProviders.includes(p))],
    fetched: now.toISOString(),
    source: source.url,
    origin: source.origin,
    complete: true,
  };
}

/** Filters applied to the catalogue by the model picker. */
export interface ModelFilter {
  /** Free-text match against id and provider. Space-separated terms all match. */
  readonly query?: string;
  readonly provider?: string;
  readonly mode?: ModelMode;
  /** Capabilities the model must support. */
  readonly caps?: readonly CapabilityName[];
  /** Hide models whose deprecation date has passed. */
  readonly hideRetired?: boolean;
}

/**
 * Apply `filter` to `models`.
 *
 * Curated entries sort first, then by ascending input price — cheapest-first is
 * the ordering a cost tool is actually asked for.
 */
export function filterModels(
  models: readonly PricedModel[],
  filter: ModelFilter,
  now: Date = new Date(),
): PricedModel[] {
  const terms = (filter.query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const today = now.toISOString().slice(0, 10);

  const matched = models.filter((model) => {
    if (filter.provider && model.provider !== filter.provider) return false;
    if (filter.mode && model.mode !== filter.mode) return false;
    if (filter.hideRetired && model.deprecation && model.deprecation < today) return false;
    if (filter.caps?.some((cap) => !model.caps[cap])) return false;
    if (terms.length > 0) {
      const haystack = `${model.id} ${model.provider} ${model.name}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });

  return matched.sort((a, b) => {
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    if (a.input !== b.input) return a.input - b.input;
    return a.id.localeCompare(b.id);
  });
}

/** Compact context-window label: `200K`, `1M`, `–` when unpublished. */
export function formatContext(tokens: number | undefined): string {
  if (!tokens) return '–';
  if (tokens >= 1_000_000) {
    // 1,048,576 is 1M as far as anyone budgeting is concerned — round, then
    // drop a trailing ".0" so it does not read as suspicious precision.
    return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** Price per million, at a precision that keeps sub-cent rates visible. */
export function formatRate(usdPerMillion: number): string {
  if (usdPerMillion === 0) return '–';
  if (usdPerMillion < 0.01) return `$${usdPerMillion.toFixed(4)}`;
  if (usdPerMillion < 1) return `$${usdPerMillion.toFixed(3)}`;
  return `$${usdPerMillion.toFixed(2)}`;
}

/** Human label for a provider slug, e.g. `bedrock_converse` → `Bedrock converse`. */
export function providerLabel(slug: string): string {
  const spaced = slug.replace(/[_-]/g, ' ').replace(/\bai\b/gi, 'AI');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Capability flags in display order, with the short labels the UI shows. */
export const CAPABILITY_LABELS: ReadonlyArray<readonly [CapabilityName, string]> = [
  ['tools', 'Tools'],
  ['vision', 'Vision'],
  ['reasoning', 'Reasoning'],
  ['caching', 'Caching'],
  ['schema', 'JSON schema'],
  ['pdf', 'PDF'],
  ['audio', 'Audio'],
  ['websearch', 'Web search'],
  ['computer', 'Computer use'],
] as const;
