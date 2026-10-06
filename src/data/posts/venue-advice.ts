/**
 * Aggregates behind the figures in the post "Stop taking AI advice on where to
 * submit your paper". Exported from the LLM_eval_research runs `naive_luna` and
 * `advisor_luna` (GPT-6 Luna, 132 blinded papers, October 2026); regenerate
 * rather than edit by hand.
 *
 * Tiers are 1 = NeurIPS oral/spotlight, 2 = main conference (NeurIPS poster,
 * EMNLP main, COLM), 3 = Findings of EMNLP, 4 = ICML/NeurIPS workshop.
 */

export type Interval = readonly [estimate: number, low: number, high: number];

export interface AucRow {
  readonly label: string;
  /** Papers in the better and the worse group. */
  readonly n: readonly [number, number];
  /** AUC of the model's acceptance probability, with a 95% bootstrap interval. */
  readonly model: Interval;
  /** AUC of blinded word count alone, with a 95% bootstrap interval. */
  readonly words: Interval;
}

export interface VenueAdviceData {
  /** `flows[actual - 1][recommended - 1]`: papers per (accepted tier, tier the plain question named). */
  readonly flows: readonly (readonly number[])[];
  /** Papers per tier: where they were accepted, and where each way of asking sent them. */
  readonly piles: {
    readonly actual: readonly number[];
    readonly naive: readonly number[];
    readonly advisor: readonly number[];
    readonly baseRate: readonly number[];
  };
  readonly auc: readonly AucRow[];
  /** The model's P(oral or spotlight), in percent, per paper in each NeurIPS group. */
  readonly pOral: {
    readonly oral: readonly number[];
    readonly poster: readonly number[];
    readonly workshop: readonly number[];
  };
}

export const TIER_LABELS = ['Oral / spotlight', 'Main conference', 'Findings', 'Workshop'] as const;

export const VENUE_ADVICE: VenueAdviceData = {
  flows: [
    [0, 28, 0, 1],
    [0, 29, 6, 1],
    [0, 18, 13, 1],
    [0, 16, 10, 9],
  ],
  piles: {
    actual: [29, 36, 32, 35],
    naive: [0, 91, 29, 12],
    advisor: [0, 5, 76, 51],
    baseRate: [83, 5, 10, 34],
  },
  auc: [
    {
      label: 'Main conference vs Findings and workshops',
      n: [65, 67],
      model: [0.6, 0.51, 0.7],
      words: [0.65, 0.55, 0.74],
    },
    {
      label: 'EMNLP main vs Findings of EMNLP',
      n: [11, 32],
      model: [0.53, 0.35, 0.71],
      words: [0.52, 0.31, 0.74],
    },
    {
      label: 'NeurIPS oral vs NeurIPS poster',
      n: [29, 14],
      model: [0.76, 0.61, 0.9],
      words: [0.58, 0.39, 0.77],
    },
    {
      label: 'NeurIPS oral vs NeurIPS workshop paper',
      n: [29, 13],
      model: [0.55, 0.35, 0.75],
      words: [0.75, 0.57, 0.9],
    },
  ],
  pOral: {
    oral: [
      0.5, 1.0, 1.0, 1.0, 1.0, 1.5, 1.5, 1.5, 2.0, 2.0, 2.5, 2.5, 2.5, 2.5, 2.5, 3.0, 3.0, 3.0, 3.0,
      3.0, 3.0, 3.0, 4.0, 4.0, 4.0, 4.0, 4.0, 5.0, 6.0,
    ],
    poster: [0.1, 0.3, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 1.5, 2.0, 2.0, 2.5, 2.5, 4.0],
    workshop: [0.5, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 3.0, 4.0, 4.0, 4.0, 5.0],
  },
};
