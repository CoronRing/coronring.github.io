/**
 * Site-wide configuration.
 *
 * Everything "about me" or "about this site" lives here rather than being
 * scattered through templates. Changing a nav label, a handle, or the tagline
 * should mean editing exactly one file.
 */
import type { IconName } from '../components/ui/icons';

export interface NavItem {
  /** Visible label. Short — the rail is narrow when collapsed. */
  readonly label: string;
  /** Root-relative path for the dedicated page. */
  readonly href: string;
  /**
   * `id` of the matching section on the single-flow home page. When present
   * and the visitor is on `/`, the rail links to the anchor and scroll-spies
   * it instead of navigating away.
   */
  readonly section?: string;
  /** Two-digit index rendered as HUD metadata. */
  readonly index: string;
  readonly icon: IconName;
  /** One-line purpose, shown in the mobile drawer. */
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
  readonly location: string;
  readonly email: string;
  readonly nav: readonly NavItem[];
  readonly social: readonly SocialLink[];
  readonly repo: string;
  /** The single persistent call to action, pinned to the rail's footer. */
  readonly cta: { readonly label: string; readonly href: string };
}

const EMAIL = 'guanzheng.huang@hotmail.com';

export const SITE: SiteConfig = {
  name: 'Guan Zheng Huang',
  handle: 'CoronRing',
  role: 'Applied ML Engineer',
  title: 'Guan Zheng Huang · Applied ML Engineer',
  description:
    'Applied ML engineer. I work on agent systems, the evaluation tooling that keeps them honest, and the infrastructure both run on. Interactive demos and open-source work.',
  url: 'https://coronring.github.io',
  locale: 'en',
  location: 'Toronto, Canada',
  email: EMAIL,
  repo: 'CoronRing/coronring.github.io',

  nav: [
    { label: 'Index', href: '/', section: 'top', index: '00', icon: 'home', blurb: 'Start here.' },
    {
      label: 'Work',
      href: '/projects',
      section: 'work',
      index: '01',
      icon: 'grid',
      blurb: 'Systems I have built.',
    },
    {
      label: 'Resume',
      href: '/resume',
      section: 'resume',
      index: '02',
      icon: 'file-text',
      blurb: 'Experience and research.',
    },
    {
      label: 'Tools',
      href: '/tools',
      section: 'tools',
      index: '03',
      icon: 'terminal',
      blurb: 'Utilities that run in your browser.',
    },
    {
      label: 'Ask',
      href: '/chat',
      section: 'ask',
      index: '04',
      icon: 'message-circle',
      blurb: 'Ask this site a question.',
    },
    {
      label: 'Resources',
      href: '/resources',
      section: 'resources',
      index: '05',
      icon: 'book',
      blurb: 'Notes and references.',
    },
  ],

  social: [
    { label: 'GitHub', href: 'https://github.com/CoronRing', icon: 'github' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/guan0huang/', icon: 'linkedin' },
    { label: 'Email', href: `mailto:${EMAIL}`, icon: 'mail' },
  ],

  cta: { label: 'Get in touch', href: `mailto:${EMAIL}` },
} as const;
