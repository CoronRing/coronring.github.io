import { useState } from 'react';
import ParticleWaveDemo from './ParticleWaveDemo';
import FeatherRingAgentDemo from './FeatherRingAgentDemo';
import PromptManagerDemo from './PromptManagerDemo';

export interface ProjectSummary {
  id: string;
  title: string;
  summary: string;
  status: string;
  tech: string[];
  period?: string;
  href: string;
}

interface Props {
  projects?: ProjectSummary[];
}

const DEFAULT_PROJECTS: ProjectSummary[] = [
  {
    id: 'particle-wave',
    title: 'Particle Wave',
    summary:
      'An image-to-particle-cloud pipeline with a real-time Verlet physics renderer. Runs 6,700 particles at 60fps in the browser.',
    status: 'in-progress',
    tech: ['TypeScript', 'Canvas', 'Python', 'Verlet physics'],
    period: '2026 – present',
    href: '/projects/particle-wave',
  },
  {
    id: 'featherring',
    title: 'FeatherRing',
    summary:
      'Multi-agent desktop operator reading all media types with Abu Dhabi Festival music module and 94% context compression.',
    status: 'in-progress',
    tech: ['Python', 'Multi-agent', 'Context management', 'Sandboxing'],
    period: '2025 – present',
    href: '/projects/featherring',
  },
  {
    id: 'gs-prompt-manager',
    title: 'gs_prompt_manager',
    summary:
      'Python package for managing prompt templates with auto-discovery, variable and macro substitution, and validation on PyPI.',
    status: 'live',
    tech: ['Python', 'PyPI', 'Apache-2.0'],
    period: '2025 – present',
    href: '/projects/gs-prompt-manager',
  },
];

export default function OperatorShowcase({ projects = DEFAULT_PROJECTS }: Props): React.ReactElement {
  const [activeId, setActiveId] = useState<string>('particle-wave');

  const activeProject = projects.find((p) => p.id === activeId) ?? projects[0]!;

  return (
    <div className="relative space-y-6">
      {/* ── Operator Master Console Frame ─────────────────────────────── */}
      <div className="overflow-hidden rounded-sm border border-[var(--c-line)] bg-[var(--c-surface)] shadow-2xl transition-all">
        {/* Console Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-[var(--c-ok)] animate-pulse" />
              <span className="size-2.5 rounded-full bg-[var(--c-warn)]" />
              <span className="size-2.5 rounded-full bg-[var(--c-accent)]" />
            </span>
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-xs font-bold tracking-wider text-[var(--c-text)]">
                OPERATOR DECK // 01
              </span>
              <span className="hidden text-[10.5px] text-[var(--c-text-faint)] sm:inline">
                INTERACTIVE SYSTEM RUNNER
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10.5px] text-[var(--c-text-faint)] md:inline">
              3 ENGINES ONLINE · 60 FPS
            </span>
            <a
              href={activeProject.href}
              className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--c-accent)] bg-[var(--c-accent-soft)] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--c-accent)] transition-colors hover:bg-[var(--c-accent-fill)] hover:text-[var(--c-accent-on-fill)]"
            >
              Open Blueprint ↗
            </a>
          </div>
        </div>

        {/* Project Selector Ribbon */}
        <div className="grid grid-cols-1 divide-y divide-[var(--c-line)] border-b border-[var(--c-line)] sm:grid-cols-3 sm:divide-y-0 sm:divide-x bg-[var(--c-sunken)]">
          {projects.map((p, index) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveId(p.id)}
                className={`flex flex-col p-3.5 text-left transition-all ${
                  isActive
                    ? 'border-b-2 border-b-[var(--c-accent)] bg-[var(--c-surface)] text-[var(--c-text)]'
                    : 'text-[var(--c-text-muted)] hover:bg-[var(--c-raised)] hover:text-[var(--c-text)]'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="font-semibold tracking-wider text-[var(--c-text-faint)] uppercase">
                    0{index + 1} // {p.id}
                  </span>
                  <span
                    className={`size-1.5 rounded-full ${
                      p.status === 'live'
                        ? 'bg-[var(--c-ok)]'
                        : 'bg-[var(--c-warn)]'
                    }`}
                  />
                </div>
                <span className="mt-1 font-mono text-sm font-semibold tracking-tight">
                  {p.title}
                </span>
                <span className="mt-0.5 line-clamp-1 text-[11px] text-[var(--c-text-faint)]">
                  {p.tech.slice(0, 3).join(' · ')}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Main 80% Interactive / Visual Viewport ─────────────────── */}
        <div className="relative min-h-[460px] bg-[var(--c-ground)]">
          {activeId === 'particle-wave' && (
            <ParticleWaveDemo title={activeProject.title} />
          )}
          {activeId === 'featherring' && (
            <FeatherRingAgentDemo title={activeProject.title} />
          )}
          {activeId === 'gs-prompt-manager' && (
            <PromptManagerDemo title={activeProject.title} />
          )}
        </div>

        {/* Active Engine Summary & Telemetry Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--c-line)] bg-[var(--c-raised)] p-4 font-mono text-xs">
          <div className="max-w-2xl">
            <p className="text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">
              <strong className="text-[var(--c-text)]">{activeProject.title}:</strong>{' '}
              {activeProject.summary}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeProject.tech.map((t) => (
              <span
                key={t}
                className="rounded-xs border border-[var(--c-line)] bg-[var(--c-surface)] px-2 py-0.5 text-[10px] text-[var(--c-text-faint)] uppercase"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
