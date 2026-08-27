import { useState, useMemo } from 'react';
import type { DemoProps } from './registry';

interface PromptPreset {
  id: string;
  name: string;
  group: string;
  template: string;
  variables: Record<string, string>;
  macros: Record<string, string>;
  note: string;
}

const PRESETS: PromptPreset[] = [
  {
    id: 'system-assistant',
    name: 'AssistantPrompt',
    group: 'manager.Assistant',
    template: `You are {agent_name}, an autonomous agent operating within {environment}.
<<SECURITY_HEADER>>
<<TOOLS_DEFINITION>>

Current user goal: {user_goal}
Strict response schema: {output_format}`,
    variables: {
      agent_name: 'FeatherRing-Core',
      environment: 'Linux Sandbox v2.4',
      user_goal: 'Analyze audio stems and generate harmonic accompaniment',
      output_format: 'JSON (id, action, timestamp)',
    },
    macros: {
      SECURITY_HEADER:
        '[GUARDRAILS ACTIVE: Never execute unsanitized bash commands outside the sandbox]',
      TOOLS_DEFINITION:
        '[AVAILABLE TOOLS: fourier_extract, wav_synth, memory_compress, bash_sandbox]',
    },
    note: 'Standard grouped system prompt with injected security macros and tool definitions.',
  },
  {
    id: 'music-analyzer',
    name: 'MusicPatternPrompt',
    group: 'manager.Music',
    template: `Analyze track {track_title} in Maqam {scale_name} at {tempo_bpm} BPM.
<<HARMONIC_RULES>>

Primary motif: {motif_notes}
Extract: Polyphonic stems, chord progressions, and dynamic velocity maps.`,
    variables: {
      track_title: 'Abu Dhabi Suite No. 3',
      scale_name: 'Bayati',
      tempo_bpm: '108',
      motif_notes: 'D4 - E4(quarter-flat) - F4 - G4 - A4',
    },
    macros: {
      HARMONIC_RULES:
        '[RULES: Retain microtonal intervals; avoid 12-TET quantization on oud stems]',
    },
    note: 'Domain-specific prompt with dynamic macro injection for musical rules.',
  },
  {
    id: 'context-compress',
    name: 'MemoryPrunePrompt',
    group: 'manager.Memory',
    template: `Compress the conversation buffer containing {token_count} tokens.
Target maximum size: {target_tokens} tokens.
<<COMPRESSION_CRITERIA>>

Preserve all active entities: {key_symbols}`,
    variables: {
      token_count: '128,000',
      target_tokens: '8,000',
      key_symbols: 'AST parser, audio node, user credentials',
    },
    macros: {
      COMPRESSION_CRITERIA:
        '[CRITERIA: Extract knowledge triplets (subject-predicate-object); prune chat pleasantries]',
    },
    note: 'Memory reduction prompt for maintaining small working context sets.',
  },
];

export default function PromptManagerDemo({ title: _title }: DemoProps): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string>(PRESETS[0]!.id);
  const preset = useMemo(
    () => PRESETS.find((p) => p.id === selectedId) ?? PRESETS[0]!,
    [selectedId],
  );

  const [variables, setVariables] = useState<Record<string, string>>(preset.variables);
  const [macros, setMacros] = useState<Record<string, string>>(preset.macros);
  const [copied, setCopied] = useState<boolean>(false);

  // When preset changes, sync form inputs
  const handleSelectPreset = (p: PromptPreset) => {
    setSelectedId(p.id);
    setVariables(p.variables);
    setMacros(p.macros);
  };

  // Compile output by replacing variables and macros
  const compiled = useMemo(() => {
    let text = preset.template;
    // Replace macros <<MACRO>>
    Object.entries(macros).forEach(([key, val]) => {
      text = text.replaceAll(`<<${key}>>`, val);
    });
    // Replace variables {var}
    Object.entries(variables).forEach(([key, val]) => {
      text = text.replaceAll(`{${key}}`, val);
    });
    return text;
  }, [preset.template, variables, macros]);

  const tokenEstimate = Math.ceil(compiled.length / 3.8);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(compiled);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col bg-[var(--c-ground)] text-[var(--c-text)]">
      {/* ── Operator Control Bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-[var(--c-accent)] uppercase">
            PROMPT STUDIO //
          </span>
          <div className="inline-flex rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p)}
                className={`rounded-sm px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                  selectedId === p.id
                    ? 'bg-[var(--c-accent-fill)] text-[var(--c-accent-on-fill)] shadow-sm'
                    : 'text-[var(--c-text-muted)] hover:text-[var(--c-text)]'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-[11px] text-[var(--c-text-faint)]">
            GROUP: <strong className="text-[var(--c-text)]">{preset.group}</strong>
          </span>
          <span className="text-[var(--c-ok)] text-[10px] border border-[var(--c-ok)]/40 bg-[var(--c-ok)]/10 px-2 py-0.5 rounded-sm">
            VALIDATED
          </span>
        </div>
      </div>

      {/* ── 80% Visual & Interactive Studio Viewport ─────────────────── */}
      <div className="grid min-h-[380px] lg:min-h-[460px] lg:grid-cols-[1.1fr_1.4fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--c-line)] border-b border-[var(--c-line)] bg-[var(--c-sunken)]">
        {/* Left: Interactive Variables & Macro Inputs */}
        <div className="flex flex-col justify-between p-4 bg-[var(--c-surface)] font-mono text-xs overflow-y-auto">
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-semibold tracking-wider text-[var(--c-text-faint)] uppercase">
                DISCOVERED CLASS & TEMPLATE
              </span>
              <p className="mt-1 text-[11px] text-[var(--c-text-muted)] leading-relaxed">
                {preset.note}
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-semibold text-[var(--c-accent)] uppercase">
                1. DYNAMIC VARIABLES ({`{var}`})
              </span>
              {Object.entries(variables).map(([key, val]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10.5px] text-[var(--c-text-muted)] flex justify-between">
                    <span>{key}</span>
                  </label>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) =>
                      setVariables((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] px-2.5 py-1.5 font-mono text-xs text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                  />
                </div>
              ))}
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--c-line)]">
              <span className="text-[10px] font-semibold text-[var(--c-warn)] uppercase">
                2. MACRO INJECTIONS ({`<<MACRO>>`})
              </span>
              {Object.entries(macros).map(([key, val]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10.5px] text-[var(--c-text-muted)]">
                    <span>{key}</span>
                  </label>
                  <textarea
                    rows={2}
                    value={val}
                    onChange={(e) =>
                      setMacros((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full resize-none rounded-sm border border-[var(--c-line)] bg-[var(--c-sunken)] p-2 font-mono text-[11px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--c-line)] text-[10.5px] text-[var(--c-text-faint)]">
            Auto-discovery scans classes in directory without manual imports.
          </div>
        </div>

        {/* Right: Live Rendered Output & Telemetry Viewport */}
        <div className="flex flex-col justify-between p-4 bg-[var(--c-sunken)] font-mono text-xs">
          <div>
            <div className="flex items-center justify-between border-b border-[var(--c-line)] pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[var(--c-ok)] animate-pulse" />
                <span className="text-[10px] font-semibold tracking-wider text-[var(--c-text-faint)] uppercase">
                  RENDERED PROMPT OUTPUT
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[var(--c-text-faint)]">
                  ~<strong className="text-[var(--c-accent)]">{tokenEstimate}</strong> TOKENS
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1 text-[11px] font-semibold hover:border-[var(--c-text)] transition-colors"
                >
                  {copied ? 'COPIED ✓' : 'COPY'}
                </button>
              </div>
            </div>

            <pre className="max-h-[340px] overflow-y-auto whitespace-pre-wrap rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] p-4 font-mono text-[12px] leading-relaxed text-[var(--c-text)]">
              {compiled}
            </pre>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[var(--c-line)] pt-3 text-[11px] text-[var(--c-text-faint)]">
            <span>gs_prompt_manager @ PyPI</span>
            <span className="text-[var(--c-ok)] font-medium">Validation: 0 Missing Keys</span>
          </div>
        </div>
      </div>
    </div>
  );
}
