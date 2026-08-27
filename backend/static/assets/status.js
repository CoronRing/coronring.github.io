/**
 * Renders /api/status.
 *
 * Everything shown here comes from that one endpoint, so `curl /api/status`
 * and this page can never disagree. Refreshes on a timer, and pauses while the
 * tab is hidden — a background tab polling a sleeping free Space forever would
 * keep waking the container for nobody's benefit.
 */

const REFRESH_MS = 10_000;

const el = (id) => document.getElementById(id);

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function duration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(0)} kB`
      : `${(n / 1048576).toFixed(1)} MB`;

/** Relative time, so "when did it last do work" is readable at a glance. */
function ago(iso) {
  if (!iso) return null;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return `${duration(seconds)} ago`;
}

function card(label, value, note, tone) {
  const wrap = document.createElement('div');
  wrap.className = 'card';

  const labelEl = document.createElement('div');
  labelEl.className = 'card-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = `card-value${tone ? ` is-${tone}` : ''}`;
  valueEl.textContent = value;

  wrap.append(labelEl, valueEl);

  if (note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'card-note';
    noteEl.textContent = note;
    wrap.append(noteEl);
  }
  return wrap;
}

function fillTable(table, rows) {
  const body = table.querySelector('tbody');
  body.textContent = '';
  for (const [key, value] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = key;
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(th, td);
    body.append(tr);
  }
}

function setVerdict(kind, heading, sub) {
  const box = el('verdict');
  box.classList.remove('is-ok', 'is-bad', 'is-warn');
  box.classList.add(`is-${kind}`);
  el('verdict-text').textContent = heading;
  el('verdict-sub').textContent = sub;
}

function render(data) {
  const m = data.metrics;

  if (data.status === 'ok') {
    setVerdict(
      'ok',
      'Operational',
      `particle-wave ${data.version} · up ${duration(m.uptime_seconds)} · ` +
        `${plural(m.conversions_ok, 'conversion')} served`,
    );
  } else {
    setVerdict(
      'warn',
      'Degraded',
      data.engine.detail || 'The engine assets could not be resolved.',
    );
  }

  const cards = el('cards');
  cards.textContent = '';
  cards.append(
    card('Uptime', duration(m.uptime_seconds), `since ${m.started_at.replace('T', ' ')}`),
    card(
      'Conversions',
      m.conversions_ok.toLocaleString(),
      m.conversions_failed ? `${m.conversions_failed} failed` : 'none failed',
    ),
    card(
      'Points produced',
      m.points_produced.toLocaleString(),
      m.mean_convert_ms ? `${m.mean_convert_ms} ms mean` : 'no timing yet',
    ),
    card(
      'In flight',
      `${m.in_flight} / ${data.limits.max_concurrency}`,
      m.in_flight ? 'working' : 'idle',
      m.in_flight ? null : 'quiet',
    ),
    card(
      'Rejected uploads',
      m.uploads_rejected.toLocaleString(),
      'bad or oversized files',
      m.uploads_rejected ? 'warn' : 'quiet',
    ),
    card(
      'Rejected options',
      m.options_rejected.toLocaleString(),
      'out of range or unknown',
      m.options_rejected ? 'warn' : 'quiet',
    ),
    card(
      'Rate limited',
      m.rate_limited.toLocaleString(),
      `${data.limits.rate_limit_per_min}/min per client`,
      m.rate_limited ? 'warn' : 'quiet',
    ),
    card(
      'Last conversion',
      ago(m.last_conversion_at) ?? 'never',
      m.last_conversion_at ? m.last_conversion_at.replace('T', ' ') : 'since this restart',
      m.last_conversion_at ? null : 'quiet',
    ),
  );

  fillTable(el('limits'), [
    ['Max upload', bytes(data.limits.max_upload_bytes)],
    ['Max image pixels', data.limits.max_image_pixels.toLocaleString()],
    ['Max dimension', `${data.limits.max_image_dimension.toLocaleString()} px per side`],
    ['Concurrent conversions', String(data.limits.max_concurrency)],
    ['Conversion timeout', `${data.limits.convert_timeout_s} s`],
    ['Rate limit', `${data.limits.rate_limit_per_min}/min, burst ${data.limits.rate_limit_burst}`],
    ['Accepted formats', data.limits.allowed_formats.join(', ')],
  ]);

  fillTable(el('build'), [
    ['Service', data.service],
    ['Package version', data.version],
    ['Extractors', data.extractors.join(', ')],
    ['Engine assets', data.engine.ok ? 'resolved from the installed wheel' : data.engine.detail],
    ['Convert endpoint', data.auth_required ? 'requires X-API-Key' : 'open (no key configured)'],
  ]);
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    setVerdict('bad', 'Unreachable', `The status endpoint did not respond: ${error.message}`);
  }
}

let timer = null;

function startPolling() {
  if (timer) return;
  timer = window.setInterval(refresh, REFRESH_MS);
}

function stopPolling() {
  if (!timer) return;
  window.clearInterval(timer);
  timer = null;
}

// A hidden tab must not keep a sleeping Space awake.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
    el('auto').textContent = 'paused while hidden';
  } else {
    el('auto').textContent = `refreshing every ${REFRESH_MS / 1000}s`;
    refresh();
    startPolling();
  }
});

refresh();
startPolling();
