/**
 * Messages between the Run Viewer and its visualizer frame.
 *
 * The visualizer is third-party code fetched from npm at visit time, so it
 * runs in a sandboxed iframe (`public/frames/railtracks-visualizer.html`)
 * with an opaque origin: it can draw, but it cannot read this site's storage,
 * cookies or DOM. Everything crosses as structured-clone messages, checked on
 * both sides against the window they must come from.
 *
 * The frame is a static file and must stay generic. Anything that depends on
 * a particular visualizer version (which build to fetch, which stylesheet it
 * needs, which React it expects) is decided on this side and sent in `load`.
 */

import type { LoadedSession } from './runs';

export type Skin = 'site' | 'original';
export type Tone = 'light' | 'dark';

/** Site colour tokens, by name without the `--c-` prefix. */
export type Palette = Record<string, string>;

export interface FrameStyle {
  skin: Skin;
  tone: Tone;
  /**
   * The site palette for each tone, used when `skin` is `site`. Both are sent
   * because the visualizer holds a theme object per tone and the frame
   * recolours each with its own palette.
   */
  palettes: Record<Tone, Palette>;
}

/** What the frame needs to draw one run, without the raw events. */
export type FrameSession = Pick<LoadedSession, 'id' | 'name' | 'source' | 'runs'> & {
  /** Raw events, sent only to a visualizer that reads them. */
  events: LoadedSession['events'];
};

export type ToFrame =
  | {
      type: 'load';
      /** esm.sh address of the bundled build. */
      bundle: string;
      version: string;
      styles: string[];
    }
  | { type: 'render'; session: FrameSession; runIndex: number; style: FrameStyle }
  | { type: 'style'; style: FrameStyle }
  | { type: 'clear' };

export type FromFrame =
  | { type: 'ready' }
  | { type: 'loaded'; version: string; ms: number; exports: string[] }
  | { type: 'rendered'; runId: string }
  | { type: 'error'; stage: 'load' | 'render'; message: string };

export const FRAME_PATH = '/frames/railtracks-visualizer.html';
