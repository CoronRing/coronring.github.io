import { useMemo, useState } from 'react';
import { Segment, StageShell } from '../StageShell';

/**
 * PromptStage — gs_prompt_manager, shown as the substitution actually happening.
 *
 * ## What there is to look at
 *
 * The package has no interface. Its whole value is that `{variable}` and
 * `<<MACRO>>` resolve out of a discovered group without any lookup
 * boilerplate, which is a claim about *text before and after*. So the stage
 * shows exactly that: one panel, and a switch that moves it between the
 * template and what the template compiles to, with every substituted span
 * marked in place.
 *
 * Two controls, because there are only two questions worth asking here: which
 * template, and which side of the substitution. The surface this replaced put
 * eight text inputs and two textareas on screen and asked the visitor to edit
 * a prompt they had never seen, which is work, not a demonstration.
 *
 * The switch is not a tab. Both states render the same block at the same
 * place, so the eye tracks the tokens rather than the layout, and the diff is
 * the thing that moves.
 */

type TemplateKey = 'assistant' | 'music' | 'memory';
type View = 'template' | 'compiled';

interface Preset {
  label: string;
  /** Attribute path the package exposes the group under. */
  group: string;
  template: string;
  variables: Readonly<Record<string, string>>;
  macros: Readonly<Record<string, string>>;
  note: string;
}

const PRESETS: Record<TemplateKey, Preset> = {
  assistant: {
    label: 'Assistant',
    group: 'manager.Assistant',
    note: 'A system prompt with the guardrail block and the tool table injected as macros.',
    template: `You are {agent_name}, operating inside {environment}.
<<GUARDRAILS>>
<<TOOLS>>

Goal: {user_goal}
Respond as: {output_format}`,
    variables: {
      agent_name: 'FeatherRing-Core',
      environment: 'a network-isolated Linux sandbox',
      user_goal: 'analyse the audio stems and write an accompaniment',
      output_format: 'JSON — id, action, timestamp',
    },
    macros: {
      GUARDRAILS: 'Never run unsanitised shell outside the sandbox.',
      TOOLS: 'fourier_extract · wav_synth · memory_compress · bash_sandbox',
    },
  },

  music: {
    label: 'Music',
    group: 'manager.Music',
    note: 'A domain template. The harmonic rules are a macro so every music prompt shares one copy.',
    template: `Analyse {track_title} in maqam {scale_name} at {tempo_bpm} BPM.
<<HARMONIC_RULES>>

Primary motif: {motif_notes}
Extract stems, chord movement, and a velocity map.`,
    variables: {
      track_title: 'Abu Dhabi Suite No. 3',
      scale_name: 'Bayati',
      tempo_bpm: '108',
      motif_notes: 'D4 · E4♭↓ · F4 · G4 · A4',
    },
    macros: {
      HARMONIC_RULES: 'Keep microtonal intervals. Do not quantise the oud to 12-TET.',
    },
  },

  memory: {
    label: 'Memory',
    group: 'manager.Memory',
    note: 'The compression prompt. Validation fails the build if a key is missing, not at run time.',
    template: `Compress a buffer of {token_count} tokens down to {target_tokens}.
<<CRITERIA>>

Preserve every live entity: {key_symbols}`,
    variables: {
      token_count: '128,000',
      target_tokens: '8,000',
      key_symbols: 'AST parser · audio node · user credentials',
    },
    macros: {
      CRITERIA: 'Extract subject–predicate–object triples. Drop pleasantries.',
    },
  },
};

const TEMPLATE_OPTIONS = (Object.keys(PRESETS) as TemplateKey[]).map((key) => ({
  value: key,
  label: PRESETS[key].label,
}));

const VIEW_OPTIONS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'template', label: 'Template' },
  { value: 'compiled', label: 'Compiled' },
];

/** One run of text, and whether it is a substitution site. */
interface Token {
  text: string;
  kind: 'plain' | 'variable' | 'macro';
}

/**
 * Split a template into plain runs and substitution sites.
 *
 * One pass over the string with a single alternation, so a `{var}` inside a
 * macro's replacement text is not re-scanned — the package resolves macros
 * first and variables second, and a second pass here would imply otherwise.
 */
function tokenize(template: string, resolve: (token: Token) => string): Token[] {
  const pattern = /\{([a-z0-9_]+)\}|<<([A-Z0-9_]+)>>/g;
  const out: Token[] = [];
  let last = 0;

  for (const match of template.matchAll(pattern)) {
    const at = match.index;
    if (at > last) out.push({ text: template.slice(last, at), kind: 'plain' });
    const token: Token = match[1]
      ? { text: match[1], kind: 'variable' }
      : { text: match[2]!, kind: 'macro' };
    out.push({ ...token, text: resolve(token) });
    last = at + match[0].length;
  }

  if (last < template.length) out.push({ text: template.slice(last), kind: 'plain' });
  return out;
}

interface Props {
  active: boolean;
}

export default function PromptStage({ active: _active }: Props): React.ReactElement {
  const [key, setKey] = useState<TemplateKey>('assistant');
  const [view, setView] = useState<View>('template');

  const preset = PRESETS[key];

  const tokens = useMemo(
    () =>
      tokenize(preset.template, (token) => {
        if (view === 'template') {
          return token.kind === 'variable' ? `{${token.text}}` : `<<${token.text}>>`;
        }
        return token.kind === 'variable'
          ? (preset.variables[token.text] ?? token.text)
          : (preset.macros[token.text] ?? token.text);
      }),
    [preset, view],
  );

  const counts = useMemo(
    () => ({
      variables: Object.keys(preset.variables).length,
      macros: Object.keys(preset.macros).length,
      /** ~3.8 chars per token is close enough for a readout, and it is labelled as an estimate. */
      tokens: Math.ceil(tokens.reduce((n, t) => n + t.text.length, 0) / 3.8),
    }),
    [preset, tokens],
  );

  return (
    <StageShell
      readout={
        <span className="flex items-center gap-3">
          <span>
            <span className="opacity-60">GROUP </span>
            {preset.group}
          </span>
          <span>
            <span className="opacity-60">~</span>
            {counts.tokens} TOK
          </span>
        </span>
      }
      hint="Switch to compiled and the marked spans resolve in place"
      controls={
        <>
          <Segment
            label="Template"
            value={key}
            options={TEMPLATE_OPTIONS}
            onChange={(next) => setKey(next)}
          />
          <Segment label="View" value={view} options={VIEW_OPTIONS} onChange={setView} />
        </>
      }
    >
      <div className="relative flex size-full items-center overflow-hidden">
        <div aria-hidden="true" className="grid-backdrop pointer-events-none absolute inset-0" />

        <div className="relative w-full px-4 py-6 lg:px-10 lg:py-10">
          <p className="eyebrow flex items-center gap-2">
            <span className="text-accent">{counts.variables} VAR</span>
            <span aria-hidden="true" className="bg-line-strong h-px w-4" />
            <span className="text-accent">{counts.macros} MACRO</span>
            <span aria-hidden="true" className="bg-line-strong h-px w-4" />
            {view === 'template' ? 'Before substitution' : 'After substitution'}
          </p>

          {/*
            Keyed on the view so the block re-enters when it flips. Both states
            occupy the same box, so the substituted spans expand in place
            rather than the panel being replaced.
          */}
          <pre
            key={`${key}-${view}`}
            className="deck-enter border-line/70 bg-surface/80 text-fg mt-4 max-h-[46vh] overflow-auto border p-5 font-mono text-[12.5px] leading-[1.85] whitespace-pre-wrap backdrop-blur-md lg:p-7 lg:text-[13.5px]"
          >
            {tokens.map((token, i) =>
              token.kind === 'plain' ? (
                <span key={i}>{token.text}</span>
              ) : (
                <mark
                  key={i}
                  className={
                    token.kind === 'variable'
                      ? 'bg-accent-soft text-accent border-accent-ring border-b'
                      : 'text-fg border-line-strong bg-raised border-b border-dashed'
                  }
                >
                  {token.text}
                </mark>
              ),
            )}
          </pre>

          <p className="text-muted mt-4 max-w-lg text-[13px] leading-relaxed">{preset.note}</p>
        </div>
      </div>
    </StageShell>
  );
}
