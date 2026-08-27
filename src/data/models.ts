/**
 * Model reference data for the token/cost tools.
 *
 * Pricing is USD per million tokens, from Anthropic's published rates as of
 * 2026-06-24. Keep this table in one place: every tool that quotes a price
 * reads from here, so a rate change is a single edit.
 *
 * `introPrice` covers time-limited promotional pricing. The UI compares
 * `introUntil` against the current date and shows whichever rate is live,
 * rather than silently going stale the day the promotion ends.
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  readonly input: number;
  /** USD per 1M output tokens. */
  readonly output: number;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  /** Context window in tokens. */
  readonly context: number;
  readonly price: ModelPricing;
  /** Promotional pricing, active until `introUntil` (ISO date, exclusive). */
  readonly introPrice?: ModelPricing;
  readonly introUntil?: string;
  /** Short positioning line shown under the model name. */
  readonly note: string;
}

export const MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    context: 1_000_000,
    price: { input: 10, output: 50 },
    note: 'Most capable. Built for demanding reasoning and long-horizon agentic work.',
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    context: 1_000_000,
    price: { input: 5, output: 25 },
    note: 'Complex agentic coding and enterprise work.',
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    context: 1_000_000,
    price: { input: 3, output: 15 },
    introPrice: { input: 2, output: 10 },
    introUntil: '2026-09-01',
    note: 'Best speed-to-intelligence balance; near-Opus on coding.',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    context: 200_000,
    price: { input: 1, output: 5 },
    note: 'Fastest and most cost-effective for simple tasks.',
  },
] as const;

/**
 * Effective pricing for `model` at the given instant, accounting for any
 * promotional rate that is still active.
 */
export function effectivePrice(model: ModelInfo, now: Date = new Date()): ModelPricing {
  if (model.introPrice && model.introUntil && now < new Date(model.introUntil)) {
    return model.introPrice;
  }
  return model.price;
}
