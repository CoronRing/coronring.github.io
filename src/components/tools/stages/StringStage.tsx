import React, { useId, useMemo, useState } from 'react';
import { findTransform, textStats, TRANSFORMS } from '../../../lib/string-kit';
import { Button, CopyButton, num, PasteButton, TextArea } from '../ui';
import OpenTool from './OpenTool';

/**
 * String Kit on the showcase screen: one input, and the transforms people
 * reach for most, applied live by the real engine in `lib/string-kit`, each
 * with its own copy button. Grouped the way the full tool groups them, so the
 * screen reads as two short lists rather than one long one.
 */

const SAMPLE = 'parse HTTP response v2';

/** Ids are from `TRANSFORMS` in `lib/string-kit`, shown in this order. */
const GROUPS = [
  { title: 'Case', ids: ['camel', 'pascal', 'snake', 'kebab', 'constant'] },
  { title: 'Encode', ids: ['base64-encode', 'url-encode', 'html-escape', 'hex'] },
] as const;

const MORE = TRANSFORMS.length - GROUPS.reduce((n, g) => n + g.ids.length, 0);

function apply(id: string, input: string): { name: string; output: string } | undefined {
  const transform = findTransform(id);
  if (!transform) return undefined;
  try {
    return { name: transform.name, output: transform.run(input) };
  } catch {
    return { name: transform.name, output: '' };
  }
}

interface Props {
  href: string;
}

export default function StringStage({ href }: Props): React.ReactElement {
  const id = useId();
  const [text, setText] = useState(SAMPLE);
  const stats = useMemo(() => textStats(text), [text]);

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        title: g.title,
        rows: g.ids.flatMap((tid) => {
          const result = apply(tid, text);
          return result ? [{ id: tid, ...result }] : [];
        }),
      })),
    [text],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
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
            rows={5}
            placeholder="Type or paste text…"
          />

          <dl className="border-line mt-1 grid grid-cols-2 border-t">
            {[
              ['Characters', stats.chars],
              ['UTF-8 bytes', stats.bytes],
              ['Words', stats.words],
              ['Lines', stats.lines],
            ].map(([label, value]) => (
              <div
                key={label}
                className="border-line border-b py-2.5 odd:border-r odd:pr-3 even:pl-3"
              >
                <dt className="eyebrow text-[10px]">{label}</dt>
                <dd className="text-fg mt-1 font-mono text-base font-semibold tabular-nums">
                  {num(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ── Live transforms ───────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          {groups.map((group) => (
            <section key={group.title}>
              <p className="eyebrow eyebrow-marked text-[10px]">{group.title}</p>
              <ul className="divide-line border-line mt-2 divide-y border-y">
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    className="group hover:bg-raised/50 grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1 transition-colors"
                  >
                    <span className="text-faint font-mono text-[11px]">{row.name}</span>
                    <code className="text-fg truncate font-mono text-[12.5px]" title={row.output}>
                      {row.output || '—'}
                    </code>
                    <CopyButton text={row.output} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <OpenTool href={href} label="Open String Kit" more={`${MORE} more transforms`} />
    </div>
  );
}
