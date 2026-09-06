/**
 * The parameter set the Particle Wave demo exposes, and the option tables its
 * controls are built from.
 *
 * `Params` is the demo's own shape, not the engine's: it is the subset a
 * visitor can reach, in the units the controls speak. {@link toEngineConfig}
 * is the one place that translates it into what the engine takes, so a control
 * can be added here without the component learning anything about the engine's
 * naming.
 */

import type { ParticleWaveConfig } from '@npmring/particle-wave';

export interface Params {
  restSpin: number;
  spinAxis: 'clock' | 'z';
  spinMaxDegree: number;
  driftAmplitude: number;
  waveStrength: number;
  waveSpeed: number;
  springK: number;
  damping: number;
  particleSize: number;
  particleShape: 'circle' | 'nofill_circle' | 'triangle' | 'square' | 'hexagon' | 'octagon';
  colorMode: 'single' | 'source' | 'gradient' | 'palette';
  colorPalette: 'rainbow' | 'aurora' | 'cyberpunk' | 'sunset' | 'neon' | 'fire' | 'ocean';
  gradientTopLeft: string;
  gradientTopRight: string;
  gradientBottomLeft: string;
  gradientBottomRight: string;
  gradientCenter: string;
  gradientCenterStrength: number;
  trailLength: number;
  trailWidth: number;
  trailDisappearSpeed: number;
  mouseMode: 'repel' | 'attract' | 'orbit' | 'none';
  mouseStrength: number;
  interactionRadius: number;
  leftClickMode: 'outward_wave' | 'inward_wave' | 'attract_burst' | 'repel_burst' | 'none';
  rightClickMode: 'inward_wave' | 'outward_wave' | 'attract_burst' | 'repel_burst' | 'none';
  burstStrength: number;
  burstRadiusScale: number;
}

/**
 * Map the panel's flat parameter set onto engine config keys.
 *
 * Most sliders are named after the engine field they drive, but the burst
 * controls are deliberately not: the panel offers one strength and one radius
 * for both buttons, where the engine keeps a separate value per button.
 */
export function toEngineConfig(p: Params): Partial<ParticleWaveConfig> {
  const { burstStrength, ...rest } = p;
  return {
    ...rest,
    leftClickBurstStrength: burstStrength,
    rightClickBurstStrength: burstStrength,
  };
}

export const DEFAULT_PARAMS: Params = {
  // Spin off by default. A cloud that is already turning makes every other
  // parameter harder to judge, and it is one click away for anyone who wants it.
  restSpin: 0,
  spinAxis: 'clock',
  spinMaxDegree: 360,
  driftAmplitude: 8,
  waveStrength: 140,
  waveSpeed: 360,
  springK: 2.6,
  damping: 4.2,
  particleSize: 2,
  particleShape: 'circle',
  colorMode: 'single',
  colorPalette: 'rainbow',
  gradientTopLeft: '#ff8a5c',
  gradientTopRight: '#7b93ff',
  gradientBottomLeft: '#ffd166',
  gradientBottomRight: '#3ddad7',
  gradientCenter: '#ffffff',
  gradientCenterStrength: 0.55,
  trailLength: 0,
  trailWidth: 1.0,
  trailDisappearSpeed: 0.65,
  mouseMode: 'repel',
  mouseStrength: 60,
  interactionRadius: 120,
  leftClickMode: 'outward_wave',
  rightClickMode: 'inward_wave',
  burstStrength: 350,
  burstRadiusScale: 2.4,
};

type SliderKey =
  | 'restSpin'
  | 'spinMaxDegree'
  | 'driftAmplitude'
  | 'mouseStrength'
  | 'interactionRadius'
  | 'burstStrength'
  | 'burstRadiusScale'
  | 'waveStrength'
  | 'waveSpeed'
  | 'springK'
  | 'damping'
  | 'particleSize'
  | 'trailLength'
  | 'trailWidth'
  | 'trailDisappearSpeed'
  | 'gradientCenterStrength';

/** Sliders, declared as data so the panel stays structured and maintainable. */
export const SLIDERS: ReadonlyArray<{
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Rendered next to the value; the units are not otherwise guessable. */
  unit?: string;
  hint: string;
}> = [
  {
    key: 'restSpin',
    label: 'Spin',
    min: 0,
    max: 1.5,
    step: 0.01,
    unit: 'rad/s',
    hint: 'Rigid rotation speed of the whole cloud.',
  },
  {
    key: 'spinMaxDegree',
    label: 'Spin Max Degree',
    min: 0,
    max: 360,
    step: 5,
    unit: '°',
    hint: '360°/0° for full continuous circle; <360° (e.g. 180°) bounces back.',
  },
  {
    key: 'driftAmplitude',
    label: 'Drift',
    min: 0,
    max: 50,
    step: 1,
    unit: 'px',
    hint: 'How far each particle wanders from its place.',
  },
  {
    key: 'mouseStrength',
    label: 'Mouse strength',
    min: 0,
    max: 1000,
    step: 10,
    hint: 'Force applied to particles under the cursor.',
  },
  {
    key: 'interactionRadius',
    label: 'Cursor radius',
    min: 20,
    max: 500,
    step: 10,
    unit: 'px',
    hint: 'Radius within which particles respond to the cursor.',
  },
  {
    key: 'burstStrength',
    label: 'Burst strength',
    min: 0,
    max: 1200,
    step: 25,
    hint: 'Force a burst click applies. Unlike a wave, it acts on everything inside its radius at once.',
  },
  {
    key: 'burstRadiusScale',
    label: 'Burst radius',
    min: 1,
    max: 5,
    step: 0.1,
    unit: '× cursor',
    hint: 'Burst reach as a multiple of the cursor radius. Above 1 it grabs particles the cursor is not already holding.',
  },
  {
    key: 'waveStrength',
    label: 'Wave strength',
    min: 0,
    max: 800,
    step: 10,
    hint: 'Displacement carried by a click wave.',
  },
  {
    key: 'waveSpeed',
    label: 'Wave speed',
    min: 60,
    max: 1000,
    step: 10,
    unit: 'px/s',
    hint: 'How fast the wavefront travels.',
  },
  {
    key: 'trailLength',
    label: 'Meteor Tail Length',
    min: 0,
    max: 16,
    step: 1,
    unit: 'steps',
    hint: '0 disables trails; 4-12 draws glowing celestial meteor/star tails.',
  },
  {
    key: 'trailWidth',
    label: 'Trail Thickness',
    min: 0.2,
    max: 3.0,
    step: 0.1,
    hint: 'Thickness multiplier for particle trajectory tails.',
  },
  {
    key: 'trailDisappearSpeed',
    label: 'Trail Fade Speed',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    hint: 'How quickly the meteor tail fades out.',
  },
  {
    key: 'gradientCenterStrength',
    label: 'Gradient center',
    min: 0,
    max: 1,
    step: 0.05,
    hint: 'How far the center color wins in the middle of the cloud. 0 leaves the corners to blend on their own.',
  },
  {
    key: 'springK',
    label: 'Spring',
    min: 0.2,
    max: 16,
    step: 0.1,
    hint: 'Pull back to rest. Attenuates near cursor to allow smooth movement.',
  },
  {
    key: 'damping',
    label: 'Damping',
    min: 0.5,
    max: 25,
    step: 0.1,
    hint: 'Energy bleed. Low overshoots and rings.',
  },
  {
    key: 'particleSize',
    label: 'Particle size',
    min: 0.5,
    max: 8,
    step: 0.1,
    unit: 'px',
    hint: 'Base radius before saliency weighting.',
  },
];

export const MOUSE_MODES: ReadonlyArray<Params['mouseMode']> = [
  'repel',
  'attract',
  'orbit',
  'none',
];
export const COLOR_MODES: ReadonlyArray<{ value: Params['colorMode']; label: string }> = [
  { value: 'single', label: 'Single color' },
  { value: 'source', label: 'Original image' },
  { value: 'gradient', label: 'Gradient, corners' },
  { value: 'palette', label: 'Palette ramp' },
];

/** The five wells of the four-corner gradient, in the order they are shown. */
export const GRADIENT_CORNERS: ReadonlyArray<{
  key:
    | 'gradientTopLeft'
    | 'gradientTopRight'
    | 'gradientBottomLeft'
    | 'gradientBottomRight'
    | 'gradientCenter';
  label: string;
}> = [
  { key: 'gradientTopLeft', label: 'Top left' },
  { key: 'gradientTopRight', label: 'Top right' },
  { key: 'gradientCenter', label: 'Center' },
  { key: 'gradientBottomLeft', label: 'Bottom left' },
  { key: 'gradientBottomRight', label: 'Bottom right' },
];
export const COLOR_PALETTES: ReadonlyArray<{ value: Params['colorPalette']; label: string }> = [
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'aurora', label: 'Aurora' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'neon', label: 'Neon' },
  { value: 'fire', label: 'Fire' },
  { value: 'ocean', label: 'Ocean' },
];
export const CLICK_MODES: ReadonlyArray<{ value: Params['leftClickMode']; label: string }> = [
  { value: 'outward_wave', label: 'Outward wave, travels out' },
  { value: 'inward_wave', label: 'Inward wave, travels in' },
  { value: 'repel_burst', label: 'Repel burst, pushes and holds' },
  { value: 'attract_burst', label: 'Attract burst, pulls and holds' },
  { value: 'none', label: 'None' },
];

/** Shared by both click-mode selects; the wave/burst split is the thing worth saying. */
export const CLICK_MODE_HINT =
  'A wave is a travelling front: it leaves the click point, kicks each particle once as it ' +
  'passes, and keeps going. A burst is a standing field: it holds everything inside its ' +
  'radius for as long as the button is down, hardest at the centre.';
export const PARTICLE_SHAPES: ReadonlyArray<{ value: Params['particleShape']; label: string }> = [
  { value: 'circle', label: 'Circle (Filled)' },
  { value: 'nofill_circle', label: 'Circle (Ring)' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'octagon', label: 'Octagon' },
];
export const SPIN_AXES: ReadonlyArray<{ value: Params['spinAxis']; label: string }> = [
  { value: 'clock', label: '2D Clockwise' },
  { value: 'z', label: '3D Z-Axis' },
];
