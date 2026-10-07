import React, { useId, useMemo, useState } from 'react';
import { estimateTokens, tokenBreakdown, type TokenBreakdown } from '../../../lib/tokens';
import { Button, num, PasteButton, TextArea } from '../ui';
import OpenTool from './OpenTool';

/**
 * Token Counter on the showcase screen: the real estimator from `lib/tokens`
 * over a prefilled, pasteable box. The readout shows the estimate, where its
 * tokens come from (the estimator charges each character class its own rate),
 * and how much of three common context windows the text would fill. No model
 * picker and no price table; those are the full tool's job.
 */

const SAMPLE = `Summarise the attached transcript in five bullets.
Focus on where the agent failed, and quote the tool call that caused it.

def score(run: dict) -> float:
    return run["passed"] / max(run["total"], 1)`;

const CLASSES: readonly { key: keyof TokenBreakdown; label: string }[] = [
  { key: 'prose', label: 'Prose' },
  { key: 'symbols', label: 'Symbols' },
  { key: 'digits', label: 'Digits' },
  { key: 'whitespace', label: 'Whitespace' },
  { key: 'cjk', label: 'CJK' },
  { key: 'overhead', label: 'Overhead' },
];

const WINDOWS = [
  { label: '32K', size: 32_000 },
  { label: '200K', size: 200_000 },
  { label: '1M', size: 1_000_000 },
] as const;

function percent(part: number, whole: number): string {
  if (part === 0) return '0%';
  const p = (part / whole) * 100;
  if (p < 0.01) return '<0.01%';
  return p < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`;
}

interface Props {
  href: string;
}

export default function TokenStage({ href }: Props): React.ReactElement {
  const id = useId();
  const [text, setText] = useState(SAMPLE);
  const estimate = useMemo(() => estimateTokens(text), [text]);
  const parts = useMemo(() => tokenBreakdown(text), [text]);
  const largest = Math.max(...CLASSES.map((c) => parts[c.key]), 1e-9);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* ── Input ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={id} className="eyebrow text-[11px]">
              Input
            </label>
            <div className="flex gap-2">
              <PasteButton onPaste={setText} />
              <Button variant="quiet" onClick={() => setText('')} disabled={text === ''}>
                Clear
              </Button>
            </div>
          </div>
          <TextArea
            id={id}
            value={text}
            onChange={setText}
            rows={11}
            placeholder="Paste a prompt…"
          />
          <div className="text-faint flex gap-4 font-mono text-[11px] tabular-nums">
            <span>{num(estimate.characters)} chars</span>
            <span>{num(estimate.words)} words</span>
            <span>{num(estimate.lines)} lines</span>
          </div>
        </div>

        {/* ── Readout ───────────────────────────────────────────────── */}
        <div className="border-line bg-raised/40 flex min-w-0 flex-col gap-5 border p-5">
          <div>
            <p className="eyebrow text-[10px]">Estimated tokens</p>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="text-fg text-5xl leading-none font-semibold tracking-tight">
                {num(estimate.tokens)}
              </span>
              <span className="text-faint font-mono text-xs">± {num(estimate.margin)}</span>
            </div>
          </div>

          <div>
            <p className="eyebrow text-[10px]">Where they come from</p>
            <ul className="mt-3 space-y-1.5">
              {CLASSES.map((c) => {
                const value = parts[c.key];
                return (
                  <li
                    key={c.key}
                    className={`grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 font-mono text-[11px] ${
                      value === 0 ? 'opacity-40' : ''
                    }`}
                  >
                    <span className="text-muted">{c.label}</span>
                    <span className="bg-sunken h-1.5 overflow-hidden rounded-full">
                      <span
                        className="bg-accent block h-full rounded-full transition-[width] duration-300"
                        style={{ width: `${(value / largest) * 100}%` }}
                      />
                    </span>
                    <span className="text-fg text-right tabular-nums">{value.toFixed(1)}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-auto">
            <p className="eyebrow text-[10px]">Context window used</p>
            <ul className="mt-3 space-y-2">
              {WINDOWS.map((w) => (
                <li
                  key={w.label}
                  className="grid grid-cols-[2.75rem_minmax(0,1fr)_3.75rem] items-center gap-3 font-mono text-[11px]"
                >
                  <span className="text-muted">{w.label}</span>
                  <span className="bg-sunken h-1.5 overflow-hidden rounded-full">
                    <span
                      className="bg-fg block h-full min-w-[2px] rounded-full transition-[width] duration-300"
                      style={{ width: `${Math.min(100, (estimate.tokens / w.size) * 100)}%` }}
                    />
                  </span>
                  <span className="text-fg text-right tabular-nums">
                    {percent(estimate.tokens, w.size)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <OpenTool href={href} label="Open Token Counter" more="Prices for 2,400 models" />
    </div>
  );
}
