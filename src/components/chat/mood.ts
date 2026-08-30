/**
 * What CoronChat is looking at.
 *
 * The dock is not a support widget parked in a corner; it is the part of the
 * site that knows what is on the page. So it says so: the mark's energy and the
 * line under the name both come from whichever band the visitor is currently
 * reading, and both change as they scroll.
 *
 * The `id`s are the section ids on the home page, which are also the ones
 * `SITE.nav` scroll-spies. A page with none of them (a project write-up, a
 * tool) falls back to `DEFAULT_MOOD`.
 */

export interface Mood {
  /** Section id, or `null` for the fallback. */
  id: string | null;
  /** One short line under the name. Lower case, no full stop: it is a caption. */
  line: string;
  /** A question worth asking here, offered when the dock nudges. */
  question: string;
  /** How lively the mark is on this band, 0..1. */
  energy: number;
}

export const DEFAULT_MOOD: Mood = {
  id: null,
  line: 'ask about this page',
  question: 'What does Guan work on?',
  energy: 0.4,
};

export const MOODS: readonly Mood[] = [
  {
    id: 'top',
    line: 'watching the cloud',
    question: 'How does the particle engine work?',
    energy: 0.85,
  },
  {
    id: 'work',
    line: 'reading the projects',
    question: 'Which project is the most technically involved?',
    energy: 0.6,
  },
  {
    id: 'resume',
    line: 'reading the experience',
    question: 'What has Guan shipped that people actually use?',
    energy: 0.5,
  },
  {
    id: 'tools',
    line: 'watching the tools',
    question: 'Which of these tools would help me most?',
    energy: 0.7,
  },
  {
    id: 'ask',
    line: 'right here',
    question: 'What should I ask you?',
    energy: 1,
  },
  {
    id: 'resources',
    line: 'reading the notes',
    question: 'What is worth reading here?',
    energy: 0.35,
  },
];

export function moodFor(id: string | null): Mood {
  if (!id) return DEFAULT_MOOD;
  return MOODS.find((m) => m.id === id) ?? DEFAULT_MOOD;
}
