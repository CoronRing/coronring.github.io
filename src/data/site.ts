/**
 * Site-wide configuration.
 *
 * Everything that is "about me" or "about this site" lives here rather than
 * being scattered through templates. Changing a nav label, a social handle, or
 * the site tagline should mean editing exactly one file.
 */

export interface NavItem {
  /** Visible label. Kept short — the nav is a single horizontal row. */
  readonly label: string;
  /** Root-relative path, no trailing slash (except "/"). */
  readonly href: string;
  /** Two-digit index rendered as HUD-style metadata beside the label. */
  readonly index: string;
  /** One-line purpose, surfaced in the mobile drawer and command palette. */
  readonly blurb: string;
}

export interface SocialLink {
  readonly label: string;
  readonly href: string;
  /** Key into the icon registry in `src/components/ui/Icon.astro`. */
  readonly icon: 'github' | 'linkedin' | 'mail' | 'rss';
}

export interface SiteConfig {
  readonly name: string;
  readonly handle: string;
  readonly role: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly locale: string;
  readonly nav: readonly NavItem[];
  readonly social: readonly SocialLink[];
  /** Shown in the footer build stamp. */
  readonly repo: string;
}

export const SITE: SiteConfig = {
  name: 'Guan Zheng Huang',
  handle: 'CoronRing',
  role: 'Agentic Developer',
  title: 'Guan Zheng Huang — Agentic Developer',
  description:
    'Systems, agents, and the tooling around them. Interactive demos, engineering write-ups, and utilities for people who build with LLMs.',
  url: 'https://coronring.github.io',
  locale: 'en',
  repo: 'CoronRing/coronring.github.io',

  nav: [
    { label: 'Index', href: '/', index: '00', blurb: 'Who I am and what I build.' },
    { label: 'Projects', href: '/projects', index: '01', blurb: 'Live, interactive demos.' },
    {
      label: 'Resume',
      href: '/resume',
      index: '02',
      blurb: 'Experience, achievements, credentials.',
    },
    { label: 'Resources', href: '/resources', index: '03', blurb: 'Notes, references, reading.' },
    { label: 'Tools', href: '/tools', index: '04', blurb: 'Utilities that run in your browser.' },
  ],

  social: [
    { label: 'GitHub', href: 'https://github.com/CoronRing', icon: 'github' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/guan-zheng-huang', icon: 'linkedin' },
    { label: 'Email', href: 'mailto:guan@railtown.ai', icon: 'mail' },
  ],
} as const;
