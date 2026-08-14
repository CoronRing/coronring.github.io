import { useMemo, useState } from 'react';
import { MODELS, effectivePrice, type ModelInfo } from '../../data/models';
import { costOf, estimateTokens, formatUsd } from '../../lib/tokens';

/**
 * TokenCounter — paste text, see an estimated token count and per-model cost.
 *
 * Runs entirely client-side. Nothing typed here is transmitted anywhere; the
 * estimate comes from `src/lib/tokens.ts`, not from an API call.
 */

const SAMPLES: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'Prose',
    text: 'Retrieval quality is decided long before the model sees a prompt. Chunking strategy, embedding choice, and the reranker do most of the work; the generation step mostly reveals whether the earlier decisions were sound.',
  },
  {
    label: 'Code',
    text: 'export async function retrieve(query: string, k = 8): Promise<Chunk[]> {\n  const embedding = await embed(query);\n  const candidates = await index.search(embedding, k * 4);\n  return rerank(query, candidates).slice(0, k);\n}',
  },
  {
    label: 'JSON schema',
    text: '{\n  "type": "object",\n  "properties": {\n    "severity": { "type": "string", "enum": ["low", "medium", "high"] },\n    "line": { "type": "integer" }\n  },\n  "required": ["severity", "line"],\n  "additionalProperties": false\n}',
  },
];

/** Number of times the input is expected to be sent, for cost projection. */
const CALL_PRESETS = [1, 100, 10_000] as const;

export default function TokenCounter(): React.ReactElement {
  const [text, setText] = useState<string>('');
  const [calls, setCalls] = useState<number>(1);
  /** Expected output length, as a multiple of input — drives output cost. */
  const [outputRatio, setOutputRatio] = useState<number>(0.25);

  const estimate = useMemo(() => estimateTokens(text), [text]);
  const outputTokens = Math.round(estimate.tokens * outputRatio);

  const rows = useMemo(
    () =>
      MODELS.map((model: ModelInfo) => {
        const price = effectivePrice(model);
        const inputCost = costOf(estimate.tokens, price.input) * calls;
        const outputCost = costOf(outputTokens, price.output) * calls;
        return {
          model,
          price,
          promo: price !== model.price,
          total: inputCost + outputCost,
          fill: estimate.tokens / model.context,
        };
      }),
    [estimate.tokens, outputTokens, calls],
  );

  const stats: ReadonlyArray<[string, string]> = [
    ['tokens', estimate.tokens.toLocaleString('en-US')],
    ['characters', estimate.characters.toLocaleString('en-US')],
    ['words', estimate.words.toLocaleString('en-US')],
    ['lines', estimate.lines.toLocaleString('en-US')],
  ];

  return (
    <div className="space-y-6">
      {/* Input */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="tc-input" className="eyebrow">
            Input text
          </label>
          <div className="flex items-center gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setText(s.text)}
                className="rounded-sm border border-[var(--c-line)] px-2 py-1 font-mono text-[10px] text-[var(--c-text-muted)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setText('')}
              disabled={text.length === 0}
              className="rounded-sm border border-transparent px-2 py-1 font-mono text-[10px] text-[var(--c-text-faint)] transition-colors hover:text-[var(--c-text)] disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <textarea
          id="tc-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={10}
          placeholder="Paste a prompt, a document, a schema — anything you want to size."
          className="w-full resize-y rounded-lg border border-[var(--c-line)] bg-[var(--c-sunken)] p-4 font-mono text-[13px] leading-relaxed text-[var(--c-text)] placeholder:text-[var(--c-text-faint)] focus:border-[var(--c-accent)] focus:outline-none"
        />
      </div>

      {/* Counts */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--c-line)] sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-[var(--c-surface)] px-4 py-3">
            <dt className="eyebrow">{label}</dt>
            <dd className="tabular mt-1.5 text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs leading-relaxed text-[var(--c-text-faint)]">
        <span className="text-[var(--c-warn)]">Estimate, not an exact count.</span> Claude's
        tokenizer isn't available client-side, so this uses a segment-weighted character model —
        typically within ±10% on prose, ±15% on code (±
        {estimate.margin.toLocaleString('en-US')} tokens here). For an authoritative figure, call{' '}
        <code className="font-mono text-[var(--c-signal)]">/v1/messages/count_tokens</code> with the
        model you'll actually use.
      </p>

      {/* Cost projection controls */}
      <div className="flex flex-wrap items-end gap-6 border-t border-[var(--c-line)] pt-6">
        <div>
          <label htmlFor="tc-calls" className="eyebrow mb-2 block">
            Calls
          </label>
          <div className="flex gap-1.5">
            {CALL_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCalls(n)}
                aria-pressed={calls === n}
                className={`tabular rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  calls === n
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                    : 'border-[var(--c-line)] text-[var(--c-text-muted)] hover:text-[var(--c-text)]'
                }`}
              >
                {n.toLocaleString('en-US')}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-[13rem] flex-1">
          <label htmlFor="tc-ratio" className="eyebrow mb-2 block">
            Output ≈ {Math.round(outputRatio * 100)}% of input (
            {outputTokens.toLocaleString('en-US')} tok)
          </label>
          <input
            id="tc-ratio"
            type="range"
            min={0}
            max={300}
            step={5}
            value={Math.round(outputRatio * 100)}
            onChange={(e) => setOutputRatio(Number(e.target.value) / 100)}
            className="w-full accent-[var(--c-accent)]"
          />
        </div>
      </div>

      {/* Per-model cost */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-[var(--c-line)] text-left">
              <th className="eyebrow pb-2.5">Model</th>
              <th className="eyebrow pb-2.5 text-right">$/1M in</th>
              <th className="eyebrow pb-2.5 text-right">$/1M out</th>
              <th className="eyebrow pb-2.5 text-right">Context used</th>
              <th className="eyebrow pb-2.5 text-right">Est. cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {rows.map(({ model, price, promo, total, fill }) => (
              <tr key={model.id}>
                <td className="py-3 pr-4">
                  <div className="font-mono text-[13px]">{model.name}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--c-text-faint)]">{model.note}</div>
                </td>
                <td className="tabular py-3 text-right font-mono text-xs">
                  ${price.input.toFixed(2)}
                  {promo && <span className="ml-1 text-[10px] text-[var(--c-ok)]">promo</span>}
                </td>
                <td className="tabular py-3 text-right font-mono text-xs">
                  ${price.output.toFixed(2)}
                </td>
                <td className="py-3 text-right">
                  <div className="tabular font-mono text-xs">
                    {fill < 0.001 && fill > 0 ? '<0.1' : (fill * 100).toFixed(1)}%
                  </div>
                  <div className="mt-1 ml-auto h-1 w-16 overflow-hidden rounded-full bg-[var(--c-raised)]">
                    <div
                      className="h-full rounded-full bg-[var(--c-accent)]"
                      style={{ width: `${Math.min(100, fill * 100)}%` }}
                    />
                  </div>
                </td>
                <td className="tabular py-3 text-right font-mono text-[13px] text-[var(--c-accent)]">
                  {formatUsd(total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--c-text-faint)]">
        Cost figures multiply the estimate above by published list rates and inherit its error. They
        exclude prompt caching, which changes the arithmetic substantially — cache reads bill at
        roughly 0.1× input, writes at 1.25× (5-minute TTL) or 2× (1-hour).
      </p>
    </div>
  );
}
