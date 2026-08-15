/**
 * Site-wide configuration.
 *
 * Everything that is "about me" or "about this site" lives here rather than
 * being scattered through templates. Changing a nav label, a social handle, or
 * the tagline should mean editing exactly one file.
 */
import type { IconName } from '../components/ui/icons';

export interface NavItem {
  /** Visible label. Short — the rail is narrow. */
  readonly label: string;
  /** Root-relative path, no trailing slash (except "/"). */
  readonly href: string;
  /** Two-digit index rendered as HUD-style metadata. */
  readonly index: string;
  /** Icon shown beside the label in the sidebar rail. */
  readonly icon: IconName;
  /** One-line purpose, surfaced in the mobile drawer. */
  readonly blurb: string;
}

export interface SocialLink {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
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
  readonly repo: string;
  /** The single persistent call to action, pinned to the rail's footer. */
  readonly cta: { readonly label: string; readonly href: string };
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
    { label: 'Index', href: '/', index: '00', icon: 'home', blurb: 'Who I am and what I build.' },
    {
      label: 'Projects',
      href: '/projects',
      index: '01',
      icon: 'grid',
      blurb: 'Live, interactive demos.',
    },
    {
      label: 'Resume',
      href: '/resume',
      index: '02',
      icon: 'file-text',
      blurb: 'Experience and achievements.',
    },
    {
      label: 'Resources',
      href: '/resources',
      index: '03',
      icon: 'book',
      blurb: 'Notes, references, reading.',
    },
    {
      label: 'Tools',
      href: '/tools',
      index: '04',
      icon: 'terminal',
      blurb: 'Utilities that run in your browser.',
    },
  ],

  social: [
    { label: 'GitHub', href: 'https://github.com/CoronRing', icon: 'github' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/guan-zheng-huang', icon: 'linkedin' },
    { label: 'Email', href: 'mailto:guan@railtown.ai', icon: 'mail' },
  ],

  cta: { label: 'Get in touch', href: 'mailto:guan@railtown.ai' },
} as const;
