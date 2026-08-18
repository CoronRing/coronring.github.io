/**
 * Demo page for the particle-wave service.
 *
 * Two halves, deliberately kept visible as two halves:
 *
 *   Python  — extraction options are POSTed with the image and the server
 *             returns a .pwcloud document. Re-running costs a request.
 *   Browser — render and physics options are pushed straight into the running
 *             engine, which is imported from /engine, i.e. out of the same
 *             installed wheel that did the extraction.
 *
 * The extraction controls are generated from `GET /api/options`, not written
 * out here. A control therefore cannot claim a range the server will reject,
 * because both come from the same pydantic model.
 */

import ParticleWave from '/engine/particle-wave.js';

// ── Element handles ─────────────────────────────────────────────────

const el = {
  statusPill: document.getElementById('status-pill'),
  dropzone: document.getElementById('dropzone'),
  dropzoneHint: document.getElementById('dropzone-hint'),
  fileInput: document.getElementById('file-input'),
  preview: document.getElementById('preview'),
  fileMeta: document.getElementById('file-meta'),
  serverControls: document.getElementById('server-controls'),
  engineControls: document.getElementById('engine-controls'),
  canvas: document.getElementById('stage'),
  stageEmpty: document.getElementById('stage-empty'),
  stageBusy: document.getElementById('stage-busy'),
  convert: document.getElementById('convert'),
  download: document.getElementById('download'),
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
  /** @type {any} */ pw: null,
  /** @type {AbortController|null} */ inflight: null,
  /** @type {number|null} */ fpsTimer: null,
};

/**
 * Engine-side controls. Unlike the extraction options these are hand-declared,
 * because the engine's config is plain JavaScript with no schema to read.
 * Defaults are pulled from `ParticleWave.DEFAULTS` so this list only has to
 * name the fields worth exposing, not restate their values.
 */
const ENGINE_FIELDS = [
  { key: 'particleSize', label: 'Particle size', min: 0.4, max: 6, step: 0.1 },
  { key: 'particleOpacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05 },
  { key: 'particleColor', label: 'Colour', type: 'color' },
  {
    key: 'restSpin',
    label: 'Spin',
    min: -0.6,
    max: 0.6,
    step: 0.005,
    fallback: 0.05,
    help: 'Rigid rotation of the cloud, radians per second.',
  },
  {
    key: 'driftAmplitude',
    label: 'Drift',
    min: 0,
    max: 40,
    step: 0.5,
    fallback: 6,
    help: 'Per-particle wander, in pixels. Makes a still cloud breathe.',
  },
  { key: 'driftSpeed', label: 'Drift speed', min: 0, max: 2, step: 0.05 },
  { key: 'springK', label: 'Spring', min: 0.2, max: 14, step: 0.1, help: 'Pull back to rest.' },
  { key: 'damping', label: 'Damping', min: 0.5, max: 24, step: 0.1 },
  {
    key: 'mouseMode',
    label: 'Cursor',
    type: 'enum',
    options: ['repel', 'attract', 'orbit', 'none'],
  },
  { key: 'mouseStrength', label: 'Cursor strength', min: 0, max: 220, step: 5 },
  { key: 'interactionRadius', label: 'Cursor radius', min: 20, max: 420, step: 10 },
];

// ── Small helpers ───────────────────────────────────────────────────

const bytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(2)} MB`;

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

// ── Control construction ────────────────────────────────────────────

/** A labelled row with a live value readout. */
function fieldRow(label, valueText, help) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const head = document.createElement('div');
  head.className = 'field-head';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'field-value';
  if (valueText !== null) valueEl.textContent = valueText;

  head.append(labelEl, valueEl);
  wrap.append(head);

  if (help) {
    const helpEl = document.createElement('p');
    helpEl.className = 'field-help';
    helpEl.textContent = help;
    wrap.append(helpEl);
  }

  return { wrap, labelEl, valueEl };
}

/**
 * Build one extraction control from its JSON Schema property.
 * @returns {HTMLElement|null} null when the property has no sensible control.
 */
function serverControl(name, prop, onChange) {
  const label = prop['x-label'] ?? name;
  const help = prop['x-help'];
  const current = () => state.serverOptions[name];
  const id = `opt-${name}`;

  // Enum → select
  if (prop.enum) {
    const { wrap, labelEl } = fieldRow(label, null, help);
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

  // Boolean → checkbox
  if (typeOf(prop) === 'boolean') {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const row = document.createElement('div');
    row.className = 'field-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = Boolean(current());
    const labelEl = document.createElement('label');
    labelEl.htmlFor = id;
    labelEl.textContent = label;
    input.addEventListener('change', () => {
      state.serverOptions[name] = input.checked;
      onChange();
    });
    row.append(input, labelEl);
    wrap.append(row);
    if (help) {
      const helpEl = document.createElement('p');
      helpEl.className = 'field-help';
      helpEl.textContent = help;
      wrap.append(helpEl);
    }
    return wrap;
  }

  const kind = typeOf(prop);
  if (kind !== 'integer' && kind !== 'number') return null;

  const range = boundsOf(prop);
  const isInt = kind === 'integer';
  const step = prop['x-step'] ?? (isInt ? 1 : 0.01);

  // Nullable number (rng_seed) → number box plus a clear-to-random button.
  if (isNullable(prop)) {
    const { wrap, labelEl } = fieldRow(label, null, help);
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

  // Plain number → slider
  const decimals = isInt ? 0 : String(step).split('.')[1]?.length ?? 2;
  const format = (v) => Number(v).toFixed(decimals);
  const { wrap, labelEl, valueEl } = fieldRow(label, format(current()), help);
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

/** Render every extraction control, grouped in the order the server gave. */
function buildServerControls(ui) {
  const { groups, schema } = ui;
  const props = schema.properties ?? {};
  el.serverControls.textContent = '';

  const markStale = () => {
    if (state.cloud) {
      el.convert.textContent = 'Re-convert';
      showMessage('Extraction options changed — convert again to apply them.', { info: true });
    }
  };

  const byGroup = new Map(groups.map((g) => [g.id, []]));
  const ungrouped = [];
  for (const [name, prop] of Object.entries(props)) {
    const control = serverControl(name, prop, markStale);
    if (!control) continue;
    const bucket = byGroup.get(prop['x-group']);
    (bucket ?? ungrouped).push(control);
  }

  for (const group of groups) {
    const controls = byGroup.get(group.id) ?? [];
    if (controls.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'group';

    const heading = document.createElement('div');
    heading.className = 'group-label';
    heading.textContent = group.label;
    section.append(heading);

    if (group.help) {
      const help = document.createElement('p');
      help.className = 'group-help';
      help.textContent = group.help;
      section.append(help);
    }

    section.append(...controls);
    el.serverControls.append(section);
  }

  if (ungrouped.length) el.serverControls.append(...ungrouped);
}

/** Render the live engine controls. */
function buildEngineControls() {
  const defaults = ParticleWave.DEFAULTS;
  el.engineControls.textContent = '';

  for (const field of ENGINE_FIELDS) {
    const initial = defaults[field.key] ?? field.fallback ?? 0;
    const id = `eng-${field.key}`;

    if (field.type === 'color') {
      const { wrap, labelEl } = fieldRow(field.label, null, field.help);
      labelEl.htmlFor = id;
      const input = document.createElement('input');
      input.type = 'color';
      input.id = id;
      input.value = typeof initial === 'string' ? initial : '#ffffff';
      input.addEventListener('input', () => state.pw?.setConfig({ [field.key]: input.value }));
      wrap.append(input);
      el.engineControls.append(wrap);
      continue;
    }

    if (field.type === 'enum') {
      const { wrap, labelEl } = fieldRow(field.label, null, field.help);
      labelEl.htmlFor = id;
      const select = document.createElement('select');
      select.id = id;
      for (const value of field.options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.value = initial;
      select.addEventListener('change', () => state.pw?.setConfig({ [field.key]: select.value }));
      wrap.append(select);
      el.engineControls.append(wrap);
      continue;
    }

    const decimals = String(field.step).split('.')[1]?.length ?? 0;
    const format = (v) => Number(v).toFixed(decimals);
    const start = field.fallback !== undefined && initial === 0 ? field.fallback : initial;

    const { wrap, labelEl, valueEl } = fieldRow(field.label, format(start), field.help);
    labelEl.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = String(field.step);
    input.value = String(start);
    input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      valueEl.textContent = format(value);
      state.pw?.setConfig({ [field.key]: value });
    });

    wrap.append(input);
    el.engineControls.append(wrap);
  }
}

/** Current engine config, read back off the controls. */
function engineConfig() {
  const config = {};
  for (const field of ENGINE_FIELDS) {
    const input = document.getElementById(`eng-${field.key}`);
    if (!input) continue;
    config[field.key] =
      input.type === 'range' ? parseFloat(input.value) : input.value;
  }
  return config;
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
  el.fileMeta.textContent = `${file.name} · ${bytes(file.size)}`;
  el.convert.disabled = false;
  showMessage(null);
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
      showMessage(
        'Stopped at the target point count. Lower the min radius for a denser cloud.',
        { info: true },
      );
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
    state.pw = await ParticleWave.init(el.canvas, { src: cloud, ...engineConfig() });
    el.stageEmpty.hidden = true;
    startFpsPolling();
  } catch (error) {
    showMessage(`The engine could not render that cloud: ${error.message}`);
  }
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

// ── Boot ────────────────────────────────────────────────────────────

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
  const ui = await response.json();
  state.serverDefaults = ui.defaults;
  state.serverOptions = { ...ui.defaults };
  buildServerControls(ui);
  return ui;
}

async function boot() {
  wireDropzone();
  buildEngineControls();

  el.convert.addEventListener('click', convert);
  el.download.addEventListener('click', download);
  el.reset.addEventListener('click', async () => {
    state.serverOptions = { ...state.serverDefaults };
    await loadOptions();
    showMessage(null);
  });

  await loadStatus();

  try {
    await loadOptions();
  } catch (error) {
    el.serverControls.textContent = '';
    showMessage(`Could not load the option schema: ${error.message}`);
  }
}

boot();
