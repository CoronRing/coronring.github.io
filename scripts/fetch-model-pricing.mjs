/**
 * Build the model pricing table the Token Counter reads.
 *
 * ## Why a generated snapshot rather than a live fetch
 *
 * LiteLLM publishes `model_prices_and_context_window.json` — the most complete
 * public price list for hosted language models, covering ~3,200 entries across
 * ~127 providers. It is also 1.8 MB, mostly of fields a cost calculator never
 * reads, and pulling it from the browser would hand a third-party origin a
 * request every time someone opens the page.
 *
 * So it is trimmed here, at author time, into a ~300 kB same-origin asset:
 *   - only token-priced modes (`chat`, `completion`, `responses`, `embedding`)
 *     — image and audio models price per image or per second, and quoting them
 *     against a token count would be wrong, not merely imprecise;
 *   - only the fields the tool shows;
 *   - prices converted to USD per **million** tokens, because that is the unit
 *     every vendor quotes and it shortens the numbers on the wire;
 *   - capability booleans packed into one bitfield.
 *
 * The result is committed. Builds stay hermetic — no network at build time, no
 * deploy that can fail because GitHub raw was briefly unavailable — and the
 * price table is a reviewable diff rather than an invisible dependency.
 *
 * Refresh with `npm run pricing:refresh`.
 *
 * Emits `public/data/model-pricing.json`, consumed by `src/lib/model-pricing.ts`.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'data',
  'model-pricing.json',
);

/** Modes priced per token. Anything else cannot be costed from a token count. */
const KEPT_MODES = new Set(['chat', 'completion', 'responses', 'embedding']);

/**
 * Capability flags, packed into a bitfield.
 *
 * Order is part of the on-the-wire format: appending is safe, reordering is
 * not. `src/lib/model-pricing.ts` unpacks against the same list.
 */
const FLAGS = [
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

/** USD per token → USD per million tokens, rounded to kill float noise. */
function perMillion(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1e6 * 1e6) / 1e6;
}

/**
 * Reduce one LiteLLM entry to the compact record the tool consumes.
 *
 * @returns The record, or `null` if the entry is not token-priced.
 */
function compact(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!KEPT_MODES.has(raw.mode)) return null;

  const input = perMillion(raw.input_cost_per_token);
  const output = perMillion(raw.output_cost_per_token);
  // An embedding model legitimately has no output price; a chat model with no
  // input price is an incomplete entry and is dropped rather than shown as free.
  if (input === undefined) return null;

  let flags = 0;
  FLAGS.forEach(([, field], i) => {
    if (raw[field] === true) flags |= 1 << i;
  });

  const record = {
    i: id,
    p: raw.litellm_provider ?? 'unknown',
    m: raw.mode,
    ci: raw.max_input_tokens ?? raw.max_tokens ?? undefined,
    co: raw.max_output_tokens ?? undefined,
    in: input,
    out: output ?? 0,
    f: flags || undefined,
  };

  const cacheRead = perMillion(raw.cache_read_input_token_cost);
  const cacheWrite = perMillion(raw.cache_creation_input_token_cost);
  if (cacheRead !== undefined) record.cr = cacheRead;
  if (cacheWrite !== undefined) record.cw = cacheWrite;
  if (typeof raw.deprecation_date === 'string') record.d = raw.deprecation_date;

  return record;
}

async function main() {
  process.stdout.write(`Fetching ${SOURCE_URL}\n`);
  const response = await fetch(SOURCE_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Source returned ${response.status} ${response.statusText}`);
  }

  const raw = await response.json();
  delete raw.sample_spec; // Documentation stub, not a model.

  const models = [];
  for (const [id, entry] of Object.entries(raw)) {
    const record = compact(id, entry);
    if (record) models.push(record);
  }

  // Sort by provider then id: a stable order keeps the committed diff readable
  // when upstream reshuffles its object keys.
  models.sort((a, b) => a.p.localeCompare(b.p) || a.i.localeCompare(b.i));

  const providers = [...new Set(models.map((m) => m.p))].sort();

  const payload = {
    /*
     * `revision` is the upstream ETag, not a build timestamp: it changes only
     * when the price list actually changes, so a rebuild on unchanged data
     * produces a byte-identical file and an empty diff.
     */
    revision: response.headers.get('etag')?.replace(/^W\/|"/g, '') ?? null,
    fetched: new Date().toISOString().slice(0, 10),
    source: SOURCE_URL,
    unit: 'usd_per_million_tokens',
    flags: FLAGS.map(([name]) => name),
    providers,
    models,
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(OUT_PATH, `${json}\n`, 'utf8');

  const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
  process.stdout.write(
    `Wrote ${models.length} models from ${providers.length} providers ` +
      `(${kb} kB) → ${path.relative(process.cwd(), OUT_PATH)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
