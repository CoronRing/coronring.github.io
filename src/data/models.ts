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
  readonly provider: string;
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
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    context: 1_000_000,
    price: { input: 5, output: 25 },
    note: 'Most capable Anthropic reasoning and agentic coding model.',
  },
  {
    id: 'gemini/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    context: 1_048_576,
    price: { input: 0.3, output: 2.5 },
    note: 'High-speed, multimodal Google model with 1M context window.',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    context: 128_000,
    price: { input: 2.5, output: 10 },
    note: 'OpenAI flagship versatile multimodal model.',
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    context: 1_000_000,
    price: { input: 0.44, output: 1.32 },
    note: 'Ultra-fast and cost-efficient reasoning and chat model.',
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
