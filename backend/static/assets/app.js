/**
 * Playground for the particle-wave service.
 *
 * Two halves, deliberately kept visible as two halves:
 *
 *   Python  — extraction options are POSTed with the image and the server
 *             returns a .pwcloud document. Re-running costs a request.
 *   Browser — render and physics options are pushed straight into the running
 *             engine, which is imported from /engine, i.e. out of the same
 *             installed wheel that did the extraction.
 *
 * Neither set of controls is written out here. The extraction schema comes
 * from `GET /api/options` and the engine schema from `/engine/engine_fields.json`
 * — both out of the same wheel that does the work — so a control cannot claim
 * a range the server will reject, or a parameter the engine does not have.
 *
 * The rail is a dock rather than a scroll: the two halves are a segmented
 * control, and each half is cut into tabs. Descriptions come in two tiers,
 * because one tier fails either way — a label alone does not say what a
 * parameter does, and a paragraph under each of eight controls turns the panel
 * back into a scroll:
 *
 *   short — a few words under the control, so a tab reads at a glance
 *   help  — the full explanation, in one hint strip, on hover or focus
 *
 * Both come from the schemas, so neither can drift from what they describe.
 */

import ParticleWave from '/engine/particle-wave.js';

// ── Element handles ─────────────────────────────────────────────────

const el = {
  statusPill: document.getElementById('status-pill'),
  cloudTags: document.getElementById('cloud-tags'),
  tagColours: document.getElementById('tag-colours'),
  tagPreview: document.getElementById('tag-preview'),
  dropzone: document.getElementById('dropzone'),
  dropzoneHint: document.getElementById('dropzone-hint'),
  fileInput: document.getElementById('file-input'),
  preview: document.getElementById('preview'),
  fileMeta: document.getElementById('file-meta'),
  modes: document.querySelectorAll('.mode'),
  modeNote: document.getElementById('mode-note'),
  tabs: document.getElementById('tabs'),
  panel: document.getElementById('panel'),
  hint: document.getElementById('hint'),
  canvas: document.getElementById('stage'),
  stageWrap: document.getElementById('stage-wrap'),
  stageEmpty: document.getElementById('stage-empty'),
  stageBusy: document.getElementById('stage-busy'),
  compareLayer: document.getElementById('compare-layer'),
  compareImg: document.getElementById('compare-img'),
  compareHandle: document.getElementById('compare-handle'),
  compareGrip: document.getElementById('compare-grip'),
  compareToggle: document.getElementById('compare-toggle'),
  compareRange: document.getElementById('compare-range'),
  compareReadout: document.getElementById('compare-readout'),
  compareLabel: document.getElementById('compare-label'),
  wipeBar: document.getElementById('wipe-bar'),
  tagOriginal: document.getElementById('tag-original'),
  tagParticles: document.getElementById('tag-particles'),
  convert: document.getElementById('convert'),
  download: document.getElementById('download'),
  copyConfig: document.getElementById('copy-config'),
  reset: document.getElementById('reset'),
  message: document.getElementById('message'),
  statPoints: document.getElementById('stat-points'),
  statMs: document.getElementById('stat-ms'),
  statSize: document.getElementById('stat-size'),
  statFps: document.getElementById('stat-fps'),
};

// ── State ───────────────────────────────────────────────────────────

const state = {
  /** @type {File|null} */ file: null,
  /** @type {string|null} */ previewUrl: null,
  /** @type {object|null} */ cloud: null,
  /** @type {object} */ serverOptions: {},
  /** @type {object} */ serverDefaults: {},
  /** @type {object} */ engine: {},
  /** @type {object} */ engineDefaults: {},
  /** @type {any} */ pw: null,
  /** @type {AbortController|null} */ inflight: null,
  /** @type {number|null} */ fpsTimer: null,
  /** @type {string|null} */ preset: null,
  mode: 'extract',
  tab: null,
  comparePct: 50,
};

let engineSchema = null;
let serverSchema = null;

// ── Layout: which parameters land on which tab ──────────────────────

/*
 * Where a group is too big for one tab, the split is written out as key lists
 * rather than left to the schema's own grouping. `interaction` carries fifteen
 * fields and `importance` nine; a tab that scrolls is the one thing this
 * layout exists to avoid, so roughly eight controls is the budget.
 */
const CURSOR_KEYS = ['mouseMode', 'mouseStrength', 'interactionRadius', 'continuousWaveInterval'];

const CLICK_KEYS = [
  'leftClickMode',
  'rightClickMode',
  'leftClickWaveAmplitude',
  'rightClickWaveAmplitude',
];

/** Everything else in `interaction` is the standing burst field. */
const BURST_KEYS = [
  'leftClickBurstStrength',
  'rightClickBurstStrength',
  'burstRadiusScale',
  'burstStopRadius',
  'burstDuration',
  'burstOutwardGain',
  'burstHoverSuppression',
];

/** The physics of a wave, as opposed to how its front is drawn. */
const WAVE_KEYS = ['waveSpeed', 'waveStrength', 'rippleCount', 'waveWidth'];

/** The importance map proper; the rest of the group is thresholding. */
const IMPORTANCE_KEYS = ['feature_mode', 'edge_weight', 'tone_weight', 'tone_sigma', 'tone_gamma'];

/** How many points and how far apart; the rest of `sampling` is the sampler. */
const POINT_KEYS = ['target_points', 'min_radius', 'max_radius', 'radius_gamma'];

/** Ambient motion, as opposed to the spring that answers it. */
const MOTION_KEYS = ['restSpin', 'spinAxis', 'spinMaxDegree', 'driftAmplitude', 'driftSpeed'];

/** The five wells the gradient editor owns; they are not drawn as fields. */
const GRADIENT_WELLS = [
  ['gradientTopLeft', 'grad-tl', 'Top-left color'],
  ['gradientTopRight', 'grad-tr', 'Top-right color'],
  ['gradientBottomLeft', 'grad-bl', 'Bottom-left color'],
  ['gradientBottomRight', 'grad-br', 'Bottom-right color'],
  ['gradientCenter', 'grad-c', 'Center color'],
];

const TABS = {
  extract: [
    { id: 'image', label: 'Image', groups: ['preprocess', 'edges'] },
    { id: 'importance', label: 'Importance', groups: ['importance'], only: IMPORTANCE_KEYS },
    { id: 'threshold', label: 'Threshold', groups: ['importance'], except: IMPORTANCE_KEYS },
    { id: 'points', label: 'Points', groups: ['sampling'], only: POINT_KEYS },
    { id: 'sampler', label: 'Sampler', groups: ['sampling'], except: POINT_KEYS },
  ],
  render: [
    { id: 'presets', label: 'Presets', presets: true },
    { id: 'colour', label: 'Color', groups: ['color'] },
    { id: 'particles', label: 'Particles', groups: ['appearance'] },
    { id: 'trails', label: 'Trails', groups: ['trails'] },
    { id: 'motion', label: 'Motion', groups: ['motion'], only: MOTION_KEYS },
    { id: 'physics', label: 'Physics', groups: ['physics'] },
    { id: 'cursor', label: 'Cursor', groups: ['interaction'], only: CURSOR_KEYS },
    { id: 'click', label: 'Click', groups: ['interaction'], only: CLICK_KEYS },
    { id: 'burst', label: 'Burst', groups: ['interaction'], only: BURST_KEYS },
    { id: 'wave', label: 'Wave', groups: ['wave', 'wave_visual'], only: WAVE_KEYS },
    { id: 'fronts', label: 'Fronts', groups: ['wave_visual'], except: WAVE_KEYS },
  ],
};

const MODE_NOTE = {
  extract: 'Runs server-side in the particle_wave package. Changing these needs a re-convert.',
  render: 'Runs in the engine shipped by the same wheel. Applies on the next frame.',
};

/**
 * When an engine control is worth showing at all. A parameter that does
 * nothing in the current mode is worse than absent: it invites the reader to
 * turn it and conclude the engine is broken.
 */
const VISIBLE_WHEN = {
  particleColor: (c) => c.colorMode === 'single',
  colorPalette: (c) => c.colorMode === 'palette',
  colorMapping: (c) => c.colorMode === 'palette',
  gradientCenterStrength: (c) => c.colorMode === 'gradient',
  gradientCenterFalloff: (c) => c.colorMode === 'gradient',
  gradientSpace: (c) => c.colorMode === 'gradient',
  particleStrokeWidth: (c) => c.particleShape === 'nofill_circle',
  trailWidth: (c) => c.trailLength > 0,
  trailDisappearSpeed: (c) => c.trailLength > 0,
  trailOpacity: (c) => c.trailLength > 0,
  spinAxis: (c) => c.restSpin !== 0,
  spinMaxDegree: (c) => c.restSpin !== 0,
  driftSpeed: (c) => c.driftAmplitude > 0,
  springCursorFalloff: (c) => c.springAttenuateNearCursor !== false,
  clickWaveVisualOpacity: (c) => c.clickWaveVisual !== false,
  clickWaveVisualMaxRadius: (c) => c.clickWaveVisual !== false,
  clickWaveVisualWidth: (c) => c.clickWaveVisual !== false,
  clickWaveVisualColor: (c) => c.clickWaveVisual !== false,
  clickWaveVisualGlow: (c) => c.clickWaveVisual !== false,
  clickWaveVisualShowRipples: (c) => c.clickWaveVisual !== false,
};

/** Friendlier wording than the raw enum values the schema carries. */
const ENUM_LABELS = {
  colorMode: {
    single: 'Single color',
    source: 'Original image',
    gradient: 'Gradient — corners',
    palette: 'Palette ramp',
  },
  particleShape: {
    circle: 'Circle',
    nofill_circle: 'Ring',
    triangle: 'Triangle',
    square: 'Square',
    hexagon: 'Hexagon',
    octagon: 'Octagon',
  },
  spinAxis: { clock: '2D — in-plane', z: '3D — Z axis' },
  gradientSpace: { cloud: 'The image bounds', canvas: 'The whole canvas' },
};

// ── Presets ─────────────────────────────────────────────────────────

/**
 * Both halves at once. Tracing a photograph and tracing a line drawing want
 * different importance maps as much as they want different particles, so a
 * preset that set only the render half would be half an answer.
 */
const PRESETS = [
  {
    id: 'human',
    name: 'Human',
    blurb: 'Portraits and photographs. Tone-led trace, source colour, fine grain.',
    extract: {
      feature_mode: 'hybrid',
      edge_weight: 0.6,
      tone_weight: 0.95,
      tone_sigma: 8,
      tone_gamma: 0.8,
      feature_quantile: 0.5,
      target_points: 7000,
      min_radius: 1.6,
    },
    engine: {
      colorMode: 'source',
      particleShape: 'circle',
      particleSize: 1.6,
      particleSizeWeight: 0.55,
      particleOpacity: 0.95,
      springK: 5.2,
      damping: 9.5,
      mouseMode: 'repel',
      mouseStrength: 80,
      interactionRadius: 110,
      rippleCount: 1,
    },
  },
  {
    id: 'nature',
    name: 'Nature',
    blurb: 'Foliage and landscape. Dense trace, green gradient, a slow wander.',
    extract: {
      feature_mode: 'hybrid',
      edge_weight: 0.75,
      tone_weight: 0.8,
      tone_sigma: 12,
      target_points: 8000,
      min_radius: 1.5,
    },
    engine: {
      colorMode: 'gradient',
      gradientTopLeft: '#0d5c3a',
      gradientTopRight: '#9fd356',
      gradientBottomLeft: '#1b8f5a',
      gradientBottomRight: '#f2e394',
      gradientCenter: '#d9f99d',
      gradientCenterStrength: 0.35,
      gradientCenterFalloff: 2.2,
      particleSize: 2.1,
      particleOpacity: 0.8,
      driftAmplitude: 6,
      driftSpeed: 0.28,
      springK: 2.2,
      damping: 5.5,
      mouseMode: 'orbit',
      interactionRadius: 150,
    },
  },
  {
    id: 'drawing',
    name: 'Drawing',
    blurb: 'Line art and ink. Pure edges, tiny stiff particles, stroke stays readable.',
    extract: {
      feature_mode: 'edge',
      canny_blur_sigma: 1.0,
      canny_low: 0.03,
      canny_high: 0.1,
      feature_floor: 0.05,
      target_points: 6000,
      min_radius: 1.4,
    },
    engine: {
      colorMode: 'single',
      particleColor: '#f2f2f5',
      particleSize: 1.2,
      particleSizeWeight: 0.3,
      particleOpacity: 1,
      particleOpacityWeight: 0.2,
      springK: 9,
      damping: 13,
      mouseStrength: 110,
      interactionRadius: 90,
      waveSpeed: 460,
      rippleCount: 0,
    },
  },
  {
    id: 'mark',
    name: 'Logo mark',
    blurb: 'Flat marks and glyphs. Intensity trace, open rings, brand gradient.',
    extract: {
      feature_mode: 'bw_intensity',
      bw_polarity: 'black_more',
      bw_gamma: 1.2,
      target_points: 5000,
      min_radius: 1.8,
    },
    engine: {
      colorMode: 'gradient',
      gradientTopLeft: '#5b8cff',
      gradientTopRight: '#b57bff',
      gradientBottomLeft: '#3ddad7',
      gradientBottomRight: '#5b8cff',
      gradientCenter: '#ffffff',
      gradientCenterStrength: 0.4,
      particleShape: 'nofill_circle',
      particleSize: 2.6,
      particleStrokeWidth: 1.1,
      particleOpacity: 0.9,
      restSpin: 0.1,
    },
  },
  {
    id: 'night',
    name: 'Night sky',
    blurb: 'Cool palette, comet trails, a cursor that gathers instead of pushing.',
    extract: {
      feature_mode: 'tone',
      tone_sigma: 6,
      target_points: 9000,
      min_radius: 1.3,
      fill_background: true,
      background_ratio: 0.2,
    },
    engine: {
      colorMode: 'palette',
      colorPalette: 'ocean',
      colorMapping: 'weight',
      particleSize: 1.4,
      particleOpacity: 0.9,
      trailLength: 8,
      trailWidth: 0.9,
      trailDisappearSpeed: 0.5,
      trailOpacity: 0.55,
      driftAmplitude: 4,
      driftSpeed: 0.2,
      mouseMode: 'attract',
      mouseStrength: 140,
      springK: 1.8,
      damping: 4,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    blurb: 'Edge-led trace, high-contrast palette, hex cells and a loud front.',
    extract: {
      feature_mode: 'hybrid',
      edge_weight: 1.1,
      tone_weight: 0.5,
      target_points: 6500,
      min_radius: 1.7,
    },
    engine: {
      colorMode: 'palette',
      colorPalette: 'cyberpunk',
      colorMapping: 'radial',
      particleShape: 'hexagon',
      particleSize: 2.4,
      particleOpacity: 0.9,
      clickWaveVisualColor: '#ff2bd1',
      clickWaveVisualOpacity: 0.95,
      clickWaveVisualShowRipples: true,
      rippleCount: 3,
      waveSpeed: 420,
    },
  },
  {
    id: 'lab',
    name: 'Physics lab',
    blurb: 'Sparse cloud, loose springs, visible fronts — for reading the simulation.',
    extract: {
      feature_mode: 'hybrid',
      target_points: 4000,
      min_radius: 2.4,
    },
    engine: {
      colorMode: 'single',
      particleColor: '#5b8cff',
      particleSize: 3,
      particleOpacity: 0.9,
      springK: 1.6,
      damping: 3.2,
      leftClickMode: 'repel_burst',
      rightClickMode: 'attract_burst',
      leftClickBurstStrength: 600,
      rightClickBurstStrength: 600,
      burstRadiusScale: 3,
      burstDuration: 420,
      rippleCount: 4,
      clickWaveVisualShowRipples: true,
    },
  },
];

// ── Small helpers ───────────────────────────────────────────────────

const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} kB`
      : `${(n / 1048576).toFixed(2)} MB`;

function showMessage(text, { info = false } = {}) {
  el.message.textContent = '';
  if (!text) {
    el.message.hidden = true;
    return;
  }
  el.message.classList.toggle('is-info', info);
  if (Array.isArray(text)) {
    const intro = document.createElement('div');
    intro.textContent = 'The server rejected these options:';
    const list = document.createElement('ul');
    for (const item of text) {
      const li = document.createElement('li');
      li.textContent = item;
      list.append(li);
    }
    el.message.append(intro, list);
  } else {
    el.message.textContent = text;
  }
  el.message.hidden = false;
}

/** Pull a usable error string out of a FastAPI error body. */
async function errorFrom(response) {
  let detail;
  try {
    detail = (await response.json())?.detail;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (d.field ? `${d.field}: ${d.message}` : JSON.stringify(d)));
  }
  return `${response.status} ${response.statusText}`;
}

/**
 * Numeric bounds for a property, seeing through the `anyOf` that pydantic
 * emits for an optional field like `rng_seed`.
 */
function boundsOf(prop) {
  if (prop.minimum !== undefined || prop.maximum !== undefined) return prop;
  for (const branch of prop.anyOf ?? []) {
    if (branch.type === 'integer' || branch.type === 'number') return branch;
  }
  return {};
}

function isNullable(prop) {
  return (prop.anyOf ?? []).some((b) => b.type === 'null');
}

function typeOf(prop) {
  if (prop.type) return prop.type;
  const branch = (prop.anyOf ?? []).find((b) => b.type && b.type !== 'null');
  return branch?.type;
}

function hexToRgb(hex) {
  const raw = String(hex).replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const v = Number.parseInt(full, 16);
  return Number.isNaN(v)
    ? { r: 255, g: 255, b: 255 }
    : { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// ── Control construction ────────────────────────────────────────────

/** The always-visible tier: a few words saying what the control is. */
function shortLine(text) {
  const node = document.createElement('p');
  node.className = 'field-short';
  node.textContent = text;
  return node;
}

/** A labelled row with a live value readout, a short line, and a hover tier. */
function fieldRow(label, valueText, { short, hint } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  // The long tier is read back out of the DOM by the hint strip, so it lives
  // on the control rather than in a lookup the strip would have to share.
  if (hint) wrap.dataset.hint = hint;

  const head = document.createElement('div');
  head.className = 'field-head';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'field-value';
  if (valueText !== null) valueEl.textContent = valueText;

  head.append(labelEl, valueEl);
  wrap.append(head);
  if (short) wrap.append(shortLine(short));

  return { wrap, labelEl, valueEl };
}

function checkboxField(id, label, { short, hint }, checked, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  if (hint) wrap.dataset.hint = hint;

  const row = document.createElement('div');
  row.className = 'field-check';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked));

  const labelEl = document.createElement('label');
  labelEl.htmlFor = id;
  labelEl.textContent = label;

  row.append(input, labelEl);
  wrap.append(row);
  if (short) wrap.append(shortLine(short));
  return wrap;
}

/**
 * Build one extraction control from its JSON Schema property.
 * @returns {HTMLElement|null} null when the property has no sensible control.
 */
function serverControl(name, prop, onChange) {
  const label = prop['x-label'] ?? name;
  const tiers = { short: prop['x-short'], hint: prop['x-help'] };
  const current = () => state.serverOptions[name];
  const id = `opt-${name}`;

  if (prop.enum) {
    const { wrap, labelEl } = fieldRow(label, null, tiers);
    labelEl.htmlFor = id;
    const select = document.createElement('select');
    select.id = id;
    for (const value of prop.enum) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    select.value = current();
    select.addEventListener('change', () => {
      state.serverOptions[name] = select.value;
      onChange();
    });
    wrap.append(select);
    return wrap;
  }

  if (typeOf(prop) === 'boolean') {
    return checkboxField(id, label, tiers, current(), (checked) => {
      state.serverOptions[name] = checked;
      onChange();
    });
  }

  const kind = typeOf(prop);
  if (kind !== 'integer' && kind !== 'number') return null;

  const range = boundsOf(prop);
  const isInt = kind === 'integer';
  const step = prop['x-step'] ?? (isInt ? 1 : 0.01);

  // Nullable number (rng_seed) → number box plus a clear-to-random button.
  if (isNullable(prop)) {
    const { wrap, labelEl } = fieldRow(label, null, tiers);
    labelEl.htmlFor = id;
    const row = document.createElement('div');
    row.className = 'field-inline';

    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    if (range.minimum !== undefined) input.min = String(range.minimum);
    if (range.maximum !== undefined) input.max = String(range.maximum);
    input.step = String(step);
    input.placeholder = 'random';
    input.value = current() ?? '';

    const randomise = document.createElement('button');
    randomise.type = 'button';
    randomise.className = 'btn-tiny';
    randomise.textContent = 'random';

    const commit = () => {
      const raw = input.value.trim();
      state.serverOptions[name] = raw === '' ? null : Number(raw);
      onChange();
    };
    input.addEventListener('change', commit);
    randomise.addEventListener('click', () => {
      input.value = '';
      commit();
    });

    row.append(input, randomise);
    wrap.append(row);
    return wrap;
  }

  const decimals = isInt ? 0 : (String(step).split('.')[1]?.length ?? 2);
  const format = (v) => Number(v).toFixed(decimals);
  const { wrap, labelEl, valueEl } = fieldRow(label, format(current()), tiers);
  labelEl.htmlFor = id;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(range.minimum ?? 0);
  input.max = String(range.maximum ?? 1);
  input.step = String(step);
  input.value = String(current());
  input.addEventListener('input', () => {
    const value = isInt ? parseInt(input.value, 10) : parseFloat(input.value);
    state.serverOptions[name] = value;
    valueEl.textContent = format(value);
    onChange();
  });

  wrap.append(input);
  return wrap;
}

/** Mark the current cloud as no longer matching the extraction options. */
function markStale() {
  if (!state.cloud) return;
  el.convert.textContent = 'Re-convert';
  showMessage('Extraction options changed — convert again to apply them.', { info: true });
}

/** Build one live engine control from its `engine_fields.json` entry. */
function engineControl(field) {
  const id = `eng-${field.key}`;
  const tiers = { short: field.short, hint: field.help };
  const value = state.engine[field.key];

  if (field.type === 'boolean') {
    return checkboxField(id, field.label, tiers, value, (checked) =>
      commitEngine(field.key, checked),
    );
  }

  if (field.type === 'color') {
    const { wrap, labelEl, valueEl } = fieldRow(field.label, String(value).toLowerCase(), tiers);
    labelEl.htmlFor = id;
    const input = document.createElement('input');
    input.type = 'color';
    input.id = id;
    input.value = typeof value === 'string' ? value : '#ffffff';
    input.addEventListener('input', () => {
      valueEl.textContent = input.value.toLowerCase();
      commitEngine(field.key, input.value);
    });
    wrap.append(input);
    return wrap;
  }

  if (field.type === 'enum') {
    const { wrap, labelEl } = fieldRow(field.label, null, tiers);
    labelEl.htmlFor = id;
    const select = document.createElement('select');
    select.id = id;
    const labels = ENUM_LABELS[field.key] ?? {};
    for (const option of field.options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = labels[option] ?? option;
      select.append(node);
    }
    select.value = String(value);
    select.addEventListener('change', () => commitEngine(field.key, select.value));
    wrap.append(select);
    return wrap;
  }

  const decimals = String(field.step ?? 1).split('.')[1]?.length ?? 0;
  const format = (v) => `${Number(v).toFixed(decimals)}${field.unit ? ` ${field.unit}` : ''}`;
  const { wrap, labelEl, valueEl } = fieldRow(field.label, format(value), tiers);
  labelEl.htmlFor = id;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(field.min ?? 0);
  input.max = String(field.max ?? 100);
  input.step = String(field.step ?? 1);
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = parseFloat(input.value);
    valueEl.textContent = format(next);
    commitEngine(field.key, next);
  });

  wrap.append(input);
  return wrap;
}

/**
 * The corner-gradient editor: five wells on a live preview of the blend,
 * painted with the same maths the renderer uses.
 */
function gradientEditor() {
  const wrap = document.createElement('div');
  wrap.className = 'grad';
  wrap.dataset.hint =
    'Four corner colors blended across the cloud, then pulled toward the center color. ' +
    'Drag a well onto a corner to see which way the ramp runs.';

  const head = document.createElement('div');
  head.className = 'field-head';
  const label = document.createElement('label');
  label.textContent = 'Corner colors';
  const value = document.createElement('span');
  value.className = 'field-value';
  value.textContent = 'click a well';
  head.append(label, value);

  const short = shortLine('one colour per corner, blended across the cloud');

  const stage = document.createElement('div');
  stage.className = 'grad-stage';
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 45;
  stage.append(canvas);

  for (const [key, className, title] of GRADIENT_WELLS) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = className;
    input.value = state.engine[key] ?? '#ffffff';
    input.title = title;
    input.setAttribute('aria-label', title);
    input.addEventListener('input', () => {
      commitEngine(key, input.value);
      paintGradient(canvas);
    });
    stage.append(input);
  }

  wrap.append(head, short, stage);
  paintGradient(canvas);
  wrap._repaint = () => paintGradient(canvas);
  return wrap;
}

/** One channel of the bilinear corner blend, pulled toward the centre by k. */
function blendChannel(tl, tr, bl, br, mid, u, v, k) {
  const top = tl + (tr - tl) * u;
  const bot = bl + (br - bl) * u;
  const base = top + (bot - top) * v;
  return base + (mid - base) * k;
}

function paintGradient(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const image = ctx.createImageData(w, h);

  const tl = hexToRgb(state.engine.gradientTopLeft);
  const tr = hexToRgb(state.engine.gradientTopRight);
  const bl = hexToRgb(state.engine.gradientBottomLeft);
  const br = hexToRgb(state.engine.gradientBottomRight);
  const mid = hexToRgb(state.engine.gradientCenter);
  const strength = Number(state.engine.gradientCenterStrength ?? 0.55);
  const falloff = Math.max(0.05, Number(state.engine.gradientCenterFalloff ?? 1.6));

  for (let y = 0; y < h; y += 1) {
    const v = h > 1 ? y / (h - 1) : 0;
    for (let x = 0; x < w; x += 1) {
      const u = w > 1 ? x / (w - 1) : 0;
      const d = Math.min(1, Math.hypot(u * 2 - 1, v * 2 - 1) / Math.SQRT2);
      const k = strength * Math.pow(1 - d, falloff);
      const i = (y * w + x) * 4;
      image.data[i] = blendChannel(tl.r, tr.r, bl.r, br.r, mid.r, u, v, k);
      image.data[i + 1] = blendChannel(tl.g, tr.g, bl.g, br.g, mid.g, u, v, k);
      image.data[i + 2] = blendChannel(tl.b, tr.b, bl.b, br.b, mid.b, u, v, k);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** The preset cards. */
function presetPanel() {
  const wrap = document.createElement('div');

  const note = document.createElement('p');
  note.className = 'group-help';
  note.textContent =
    'A preset sets both halves: the extraction options, which need a re-convert, ' +
    'and the render options, which apply immediately. Everything stays editable after.';
  wrap.append(note);

  const grid = document.createElement('div');
  grid.className = 'presets';
  for (const preset of PRESETS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset';
    card.dataset.preset = preset.id;
    card.dataset.hint = preset.blurb;
    card.setAttribute('aria-pressed', String(state.preset === preset.id));

    const name = document.createElement('b');
    name.textContent = preset.name;
    const blurb = document.createElement('span');
    blurb.textContent = preset.blurb;

    card.append(name, blurb);
    card.addEventListener('click', () => applyPreset(preset));
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

// ── Panel rendering ─────────────────────────────────────────────────

function buildTabs() {
  el.tabs.textContent = '';
  for (const tab of TABS[state.mode]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.setAttribute('role', 'tab');
    button.dataset.tab = tab.id;
    button.textContent = tab.label;
    button.addEventListener('click', () => selectTab(tab.id));
    el.tabs.append(button);
  }
}

function selectMode(mode) {
  state.mode = mode;
  for (const button of el.modes) {
    button.setAttribute('aria-selected', String(button.dataset.mode === mode));
  }
  el.modeNote.textContent = MODE_NOTE[mode];
  buildTabs();
  selectTab(TABS[mode][0].id);
}

function selectTab(id) {
  state.tab = id;
  for (const button of el.tabs.children) {
    button.setAttribute('aria-selected', String(button.dataset.tab === id));
  }
  renderPanel();
}

/** Which engine fields belong to the current tab, in schema order. */
function fieldsForTab(tab) {
  const fields = engineSchema?.fields ?? [];
  return fields.filter((field) => {
    if (!tab.groups?.includes(field.group)) return false;
    if (tab.only && !tab.only.includes(field.key)) return false;
    if (tab.except && tab.except.includes(field.key)) return false;
    return true;
  });
}

function renderPanel() {
  const tab = TABS[state.mode].find((t) => t.id === state.tab);
  el.panel.textContent = '';
  if (!tab) return;

  if (tab.presets) {
    el.panel.append(presetPanel());
    return;
  }

  if (state.mode === 'extract') {
    renderServerTab(tab);
  } else {
    renderEngineTab(tab);
  }
  refreshVisibility();
}

function renderServerTab(tab) {
  if (!serverSchema) {
    const loading = document.createElement('p');
    loading.className = 'loading';
    loading.textContent = 'loading options…';
    el.panel.append(loading);
    return;
  }

  const props = serverSchema.schema.properties ?? {};
  for (const group of serverSchema.groups) {
    if (!tab.groups.includes(group.id)) continue;

    const controls = [];
    for (const [name, prop] of Object.entries(props)) {
      if (prop['x-group'] !== group.id) continue;
      if (tab.only && !tab.only.includes(name)) continue;
      if (tab.except && tab.except.includes(name)) continue;
      const control = serverControl(name, prop, markStale);
      if (control) controls.push(control);
    }
    if (controls.length === 0) continue;

    el.panel.append(groupSection(group, controls));
  }
}

function renderEngineTab(tab) {
  if (!engineSchema) {
    const problem = document.createElement('p');
    problem.className = 'loading';
    problem.textContent = 'the engine did not publish a parameter schema';
    el.panel.append(problem);
    return;
  }

  const wellKeys = new Set(GRADIENT_WELLS.map(([key]) => key));
  const byGroup = new Map();

  for (const field of fieldsForTab(tab)) {
    const bucket = byGroup.get(field.group) ?? [];

    // The five gradient wells are drawn once, as one editor, in the place the
    // first of them would have taken.
    if (wellKeys.has(field.key)) {
      if (field.key === GRADIENT_WELLS[0][0]) {
        const editor = gradientEditor();
        editor._when = (config) => config.colorMode === 'gradient';
        bucket.push(editor);
      }
    } else {
      const control = engineControl(field);
      control._when = VISIBLE_WHEN[field.key];
      bucket.push(control);
    }

    byGroup.set(field.group, bucket);
  }

  for (const group of engineSchema.groups ?? []) {
    const controls = byGroup.get(group.id);
    if (!controls?.length) continue;
    el.panel.append(groupSection(group, controls));
  }
}

function groupSection(group, controls) {
  const section = document.createElement('div');
  section.className = 'group';
  if (group.help) section.dataset.hint = group.help;

  const heading = document.createElement('div');
  heading.className = 'group-label';
  heading.textContent = group.label;
  if (group.short) {
    const short = document.createElement('span');
    short.className = 'group-short';
    short.textContent = group.short;
    heading.append(short);
  }
  section.append(heading);

  section.append(...controls);
  return section;
}

/** Re-evaluate every visibility rule against the current engine config. */
function refreshVisibility() {
  for (const section of el.panel.children) {
    let shown = 0;
    for (const control of section.children) {
      if (!control._when) {
        if (control.classList?.contains('field') || control.classList?.contains('grad')) shown += 1;
        continue;
      }
      control.hidden = !control._when(state.engine);
      if (!control.hidden) shown += 1;
    }
    // A group whose every control is hidden is a heading over nothing.
    section.hidden = shown === 0;
  }
}

/** Push one engine change into the running instance. */
function commitEngine(key, value) {
  state.engine[key] = value;
  state.pw?.setConfig({ [key]: value });

  // A hand edit means this is no longer exactly the preset it started from.
  if (state.preset !== null) {
    state.preset = null;
    for (const card of el.panel.querySelectorAll('.preset')) {
      card.setAttribute('aria-pressed', 'false');
    }
  }

  refreshVisibility();
  for (const section of el.panel.children) {
    for (const control of section.children) control._repaint?.();
  }
}

function applyPreset(preset) {
  state.serverOptions = { ...state.serverDefaults, ...preset.extract };
  state.engine = { ...state.engineDefaults, ...preset.engine };
  state.preset = preset.id;

  state.pw?.setConfig({ ...state.engine });

  for (const card of el.panel.querySelectorAll('.preset')) {
    card.setAttribute('aria-pressed', String(card.dataset.preset === preset.id));
  }
  markStale();
  if (!state.cloud) {
    showMessage(`${preset.name} preset applied. Choose an image and convert.`, { info: true });
  }
}

// ── Hint strip ──────────────────────────────────────────────────────

const IDLE_HINT = 'Hover or focus a control for the long description.';

function showHint(target) {
  const owner = target?.closest?.('[data-hint]');
  el.hint.textContent = owner ? owner.dataset.hint : IDLE_HINT;
  el.hint.classList.toggle('is-idle', !owner);
}

// ── File selection ──────────────────────────────────────────────────

function chooseFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showMessage('That does not look like an image.');
    return;
  }

  state.file = file;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);

  el.preview.src = state.previewUrl;
  el.preview.hidden = false;
  el.dropzoneHint.hidden = true;
  el.dropzone.closest('.panel-source')?.classList.add('has-file');
  el.fileMeta.textContent = `${file.name} · ${bytes(file.size)}`;
  el.convert.disabled = false;
  showMessage(null);
  syncCompareSource();
}

function wireDropzone() {
  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      el.fileInput.click();
    }
  });
  el.fileInput.addEventListener('change', () => chooseFile(el.fileInput.files?.[0]));

  for (const type of ['dragenter', 'dragover']) {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.remove('is-over');
    });
  }
  el.dropzone.addEventListener('drop', (event) => chooseFile(event.dataTransfer?.files?.[0]));
}

// ── Compare wipe ────────────────────────────────────────────────────

/**
 * The image to wipe against: the file in the dropzone when there is one,
 * otherwise whatever the cloud carries with it. A cloud produced here always
 * has both, but one loaded from disk may only have the embedded preview.
 */
function compareSource() {
  return state.previewUrl ?? state.pw?.sourcePreview?.url ?? null;
}

function syncCompareSource() {
  const url = compareSource();
  if (url) el.compareImg.src = url;

  const usable = Boolean(url) && Boolean(state.pw);
  el.compareToggle.disabled = !usable;
  el.compareRange.disabled = !usable || !el.compareToggle.checked;
  el.compareLabel.title = usable
    ? 'Wipe between the source image and the cloud traced from it'
    : 'Available once an image has been converted';

  if (!usable && el.compareToggle.checked) {
    el.compareToggle.checked = false;
    setCompare(false);
  }
}

function setCompare(on) {
  el.compareLayer.hidden = !on;
  el.compareHandle.hidden = !on;
  el.tagOriginal.hidden = !on;
  el.tagParticles.hidden = !on;
  el.compareRange.disabled = !on;
  el.wipeBar.dataset.on = on ? 'true' : 'false';
  if (on) layoutCompare();
}

/**
 * Line the source image up with the particles.
 *
 * The engine letterboxes the cloud inside the canvas, so the image has to sit
 * on exactly that rectangle. Stretched to the canvas instead, the wipe would
 * compare two differently-scaled pictures, which is worse than no comparison.
 */
function layoutCompare() {
  if (!state.pw || el.compareLayer.hidden) return;
  const area = state.pw.drawArea;
  el.compareImg.style.left = `${area.x}px`;
  el.compareImg.style.top = `${area.y}px`;
  el.compareImg.style.width = `${area.width}px`;
  el.compareImg.style.height = `${area.height}px`;
  setComparePct(state.comparePct);
}

function setComparePct(pct) {
  state.comparePct = Math.min(100, Math.max(0, pct));
  el.compareLayer.style.clipPath = `inset(0 ${(100 - state.comparePct).toFixed(2)}% 0 0)`;
  el.compareHandle.style.left = `${state.comparePct.toFixed(2)}%`;
  el.compareRange.value = String(state.comparePct);
  el.compareReadout.textContent = `${Math.round(state.comparePct)}%`;
}

function wireCompare() {
  el.compareToggle.addEventListener('change', () => setCompare(el.compareToggle.checked));
  el.compareRange.addEventListener('input', () => setComparePct(Number(el.compareRange.value)));

  // Pointer capture keeps the drag alive when the pointer leaves the stage,
  // which is easy to do at the edges.
  el.compareGrip.addEventListener('pointerdown', (event) => {
    el.compareGrip.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  el.compareGrip.addEventListener('pointermove', (event) => {
    if (!el.compareGrip.hasPointerCapture(event.pointerId)) return;
    const rect = el.stageWrap.getBoundingClientRect();
    setComparePct(((event.clientX - rect.left) / rect.width) * 100);
  });
  el.compareGrip.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') {
      setComparePct(state.comparePct - step);
      event.preventDefault();
    }
    if (event.key === 'ArrowRight') {
      setComparePct(state.comparePct + step);
      event.preventDefault();
    }
  });

  new ResizeObserver(() => layoutCompare()).observe(el.stageWrap);
}

// ── Conversion ──────────────────────────────────────────────────────

async function convert() {
  if (!state.file) return;

  state.inflight?.abort();
  const controller = new AbortController();
  state.inflight = controller;

  el.convert.disabled = true;
  el.stageBusy.hidden = false;
  showMessage(null);

  const body = new FormData();
  body.append('image', state.file, state.file.name);
  body.append('options', JSON.stringify(state.serverOptions));

  try {
    const response = await fetch('/api/convert', {
      method: 'POST',
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      showMessage(await errorFrom(response));
      return;
    }

    const payload = await response.json();
    state.cloud = payload.cloud;

    el.statPoints.textContent = payload.meta.point_count.toLocaleString();
    el.statMs.textContent = `${payload.meta.elapsed_ms} ms`;
    el.statSize.textContent = bytes(JSON.stringify(payload.cloud).length);
    el.download.disabled = false;
    el.convert.textContent = 'Convert';

    if (payload.meta.truncated_to_cap) {
      showMessage('Stopped at the target point count. Lower the min radius for a denser cloud.', {
        info: true,
      });
    }

    await render(payload.cloud);
  } catch (error) {
    if (error.name === 'AbortError') return;
    showMessage(`Could not reach the converter: ${error.message}`);
  } finally {
    if (state.inflight === controller) state.inflight = null;
    el.stageBusy.hidden = true;
    el.convert.disabled = !state.file;
  }
}

// ── Rendering ───────────────────────────────────────────────────────

async function render(cloud) {
  state.pw?.destroy();
  state.pw = null;

  // Size the backing store before init. A fresh canvas reports 300x150, not 0,
  // so the engine's own "size me if unset" path would not fire and the first
  // frame would be built at the wrong resolution.
  const rect = el.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  el.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  el.canvas.height = Math.max(1, Math.round(rect.height * dpr));

  try {
    state.pw = await ParticleWave.init(el.canvas, { src: cloud, ...state.engine });
    el.stageEmpty.hidden = true;
    describeCloud();
    syncCompareSource();
    if (el.compareToggle.checked) layoutCompare();
    startFpsPolling();
  } catch (error) {
    showMessage(`The engine could not render that cloud: ${error.message}`);
  }
}

/** Report what this cloud can and cannot do. */
function describeCloud() {
  el.cloudTags.hidden = false;

  const colours = Boolean(state.pw?.hasSourceColors);
  el.tagColours.textContent = colours ? 'point colors' : 'no colors';
  el.tagColours.className = colours ? 'tag tag-live' : 'tag tag-quiet';

  const preview = Boolean(state.pw?.sourcePreview);
  el.tagPreview.textContent = preview ? 'carries source' : 'no source';
  el.tagPreview.className = preview ? 'tag tag-live' : 'tag tag-quiet';
}

function startFpsPolling() {
  if (state.fpsTimer) return;
  state.fpsTimer = window.setInterval(() => {
    const fps = state.pw?.stats?.fps;
    el.statFps.textContent = fps ? Math.round(fps).toString() : '—';
  }, 500);
}

// ── Download ────────────────────────────────────────────────────────

function download() {
  if (!state.cloud) return;
  const blob = new Blob([JSON.stringify(state.cloud)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const base = (state.file?.name ?? 'cloud').replace(/\.[^.]+$/, '');
  link.href = url;
  link.download = `${base}.pwcloud`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyConfig() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.engine, null, 2));
    el.copyConfig.textContent = 'Copied';
  } catch {
    el.copyConfig.textContent = 'Clipboard blocked';
  }
  window.setTimeout(() => {
    el.copyConfig.textContent = 'Copy engine config';
  }, 1400);
}

// ── Boot ────────────────────────────────────────────────────────────

/**
 * The engine's own parameter schema, out of the installed package.
 *
 * Served from /engine rather than copied into this repo's static assets: the
 * copy that used to live there went stale the moment the engine gained a
 * parameter, and a control list that disagrees with the engine is worse than
 * no control list.
 */
async function loadEngineSchema() {
  try {
    const response = await fetch('/engine/engine_fields.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    engineSchema = await response.json();
  } catch (error) {
    console.warn('Could not load the engine parameter schema:', error);
    return;
  }

  const defaults = ParticleWave.DEFAULTS ?? {};
  for (const field of engineSchema.fields ?? []) {
    state.engineDefaults[field.key] = defaults[field.key] ?? field.default;
  }
  state.engine = { ...state.engineDefaults };
}

async function loadStatus() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(String(response.status));
    const health = await response.json();
    el.statusPill.textContent = `particle-wave ${health.version}`;
    el.statusPill.classList.remove('pill-idle');
    el.statusPill.classList.add('pill-ok');
    el.statusPill.title =
      `extractors: ${health.extractors.join(', ')}\n` +
      `auth: ${health.auth_required ? 'API key required' : 'open'}\n` +
      `max upload: ${bytes(health.limits.max_upload_bytes)}\n` +
      `formats: ${health.limits.allowed_formats.join(', ')}`;
  } catch {
    el.statusPill.textContent = 'backend unreachable';
    el.statusPill.classList.add('pill-bad');
  }
}

async function loadOptions() {
  const response = await fetch('/api/options');
  if (!response.ok) throw new Error(`options request failed: ${response.status}`);
  serverSchema = await response.json();
  state.serverDefaults = serverSchema.defaults;
  state.serverOptions = { ...serverSchema.defaults };
}

async function boot() {
  wireDropzone();
  wireCompare();

  el.panel.addEventListener('pointerover', (event) => showHint(event.target));
  el.panel.addEventListener('focusin', (event) => showHint(event.target));
  el.panel.addEventListener('pointerleave', () => showHint(null));

  for (const button of el.modes) {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
  }

  el.convert.addEventListener('click', convert);
  el.download.addEventListener('click', download);
  el.copyConfig.addEventListener('click', copyConfig);
  el.reset.addEventListener('click', () => {
    state.serverOptions = { ...state.serverDefaults };
    state.engine = { ...state.engineDefaults };
    state.preset = null;
    state.pw?.setConfig({ ...state.engine });
    renderPanel();
    showMessage(null);
  });

  await loadEngineSchema();
  selectMode('extract');

  await loadStatus();

  try {
    await loadOptions();
    renderPanel();
  } catch (error) {
    showMessage(`Could not load the option schema: ${error.message}`);
  }
}

boot();
