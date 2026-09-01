/**
 * Read Time: how long this takes to read, and how long to say.
 *
 * Two answers side by side. The estimate is a word count against a published
 * rate and is instant. The measurement drives the browser's own speech engine,
 * watches its progress events, and fits a rate from the first couple of seconds.
 *
 * The measured figure is the interesting one, because speaking rate varies by
 * more than 2x across the voices on one machine, and no word-count model can
 * know which voice you are going to use.
 *
 * @see src/lib/speech-time.ts for the engine
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_MEASURE,
  MeasureError,
  READING_MODES,
  count,
  estimate,
  formatDuration,
  languageFactor,
  loadVoices,
  measureSpeech,
  playSpeech,
  readability,
  speechSupported,
  type Measurement,
  type PlaybackHandle,
  type Voice,
} from '../../lib/speech-time';
import {
  Badge,
  Button,
  CopyButton,
  ErrorNote,
  Field,
  Panel,
  PasteButton,
  Segmented,
  Select,
  Slider,
  StatRow,
  TextArea,
  Toolbar,
  num,
  usePersisted,
} from './ui';

const SAMPLE = `Retrieval quality dies at chunk boundaries. A splitter that cuts mid-sentence hands the retriever half a thought, and the half it kept is the half that scores.

Most chunkers are configured once and never inspected. The parameters look reasonable, the index builds, the numbers come out, and nobody looks at where the cuts landed. That is where the quality went.

So the tool paints the cuts in place. You can see the boundary that split a definition from its example, and the overlap you asked for that the splitter quietly failed to give you.`;

export default function ReadTime(): React.ReactElement {
  const [text, setText] = usePersisted('read-time.text', SAMPLE);
  const [modeId, setModeId] = usePersisted('read-time.mode', 'silent');
  const [pauseMs, setPauseMs] = usePersisted('read-time.pause', 0);
  const [language, setLanguage] = usePersisted('read-time.lang', 'en-US');

  const deferred = useDeferredValue(text);
  const counted = useMemo(() => count(deferred), [deferred]);
  const mode = READING_MODES.find((entry) => entry.id === modeId) ?? READING_MODES[0]!;

  const projection = useMemo(
    () => estimate(counted, mode.wpm, language, { sentencePauseMs: pauseMs }),
    [counted, mode.wpm, language, pauseMs],
  );

  const grade = useMemo(() => readability(counted), [counted]);
  const isEnglish = language.toLowerCase().startsWith('en');

  return (
    <div className="space-y-5">
      <Panel
        title="Text"
        cornerTicks
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <PasteButton onPaste={setText} />
            <Button variant="quiet" onClick={() => setText(SAMPLE)}>
              Load example
            </Button>
            <Button variant="quiet" onClick={() => setText('')} disabled={text === ''}>
              Clear
            </Button>
          </div>
        }
      >
        <TextArea
          id="read-time-text"
          value={text}
          onChange={setText}
          rows={9}
          placeholder="Paste a script, an article, or a set of slide notes. Or drop a text file."
        />
        <StatRow
          columns={6}
          stats={[
            {
              label: 'Words',
              value: num(counted.words),
              hint: counted.scriptWithoutSpaces ? 'estimated from characters' : undefined,
              tone: 'accent',
            },
            { label: 'Characters', value: num(counted.chars) },
            { label: 'Sentences', value: num(counted.sentences) },
            {
              label: 'Words/sentence',
              value: counted.sentences > 0 ? (counted.words / counted.sentences).toFixed(1) : '0',
            },
            { label: 'Syllables', value: num(counted.syllables), hint: 'English heuristic' },
            {
              label: 'Reading ease',
              value: isEnglish && counted.words > 20 ? grade.flesch.toFixed(0) : '–',
              hint:
                isEnglish && counted.words > 20
                  ? `grade ${grade.grade.toFixed(1)}`
                  : 'English only',
            },
          ]}
        />
      </Panel>

      {/* ── Estimate ──────────────────────────────────────────────── */}
      <Panel
        title="Estimate from word count"
        cornerTicks
        aside={
          <span className="tabular font-mono text-[13px] font-semibold text-[var(--c-accent)]">
            {formatDuration(projection.seconds)}
          </span>
        }
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Delivery" htmlFor="rt-mode">
            <Select
              id="rt-mode"
              value={modeId}
              onChange={setModeId}
              options={READING_MODES.map((entry) => ({
                value: entry.id,
                label: `${entry.label} · ${entry.wpm} wpm`,
              }))}
            />
          </Field>

          <Field
            label="Language"
            htmlFor="rt-lang"
            hint={`Rate factor ${languageFactor(language).toFixed(2)}x on the English baseline.`}
          >
            <Select
              id="rt-lang"
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'en-US', label: 'English' },
                { value: 'de-DE', label: 'German' },
                { value: 'fr-FR', label: 'French' },
                { value: 'es-ES', label: 'Spanish' },
                { value: 'it-IT', label: 'Italian' },
                { value: 'pt-BR', label: 'Portuguese' },
                { value: 'nl-NL', label: 'Dutch' },
                { value: 'pl-PL', label: 'Polish' },
                { value: 'ru-RU', label: 'Russian' },
                { value: 'tr-TR', label: 'Turkish' },
                { value: 'ar-SA', label: 'Arabic' },
                { value: 'hi-IN', label: 'Hindi' },
                { value: 'ja-JP', label: 'Japanese' },
                { value: 'ko-KR', label: 'Korean' },
                { value: 'zh-CN', label: 'Chinese' },
                { value: 'th-TH', label: 'Thai' },
                { value: 'vi-VN', label: 'Vietnamese' },
              ]}
            />
          </Field>

          <Slider
            id="rt-pause"
            label="Pause per sentence"
            value={pauseMs}
            min={0}
            max={1500}
            step={50}
            suffix=" ms"
            onChange={setPauseMs}
          />
        </div>

        <p className="border-t border-[var(--c-line)] bg-[var(--c-raised)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[var(--c-text-muted)]">
          {mode.note}
        </p>

        {counted.scriptWithoutSpaces && (
          <p className="border-t border-[var(--c-line)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[var(--c-warn)]">
            This text has no spaces to count words by, so the word figure is the character count
            divided by 1.5. Treat it as a rough guide: for Chinese, Japanese and Thai the measured
            duration below is far more reliable than any word model.
          </p>
        )}
      </Panel>

      <Measured text={deferred} language={language} estimated={projection.seconds} />
    </div>
  );
}

/* ── Measurement ──────────────────────────────────────────────────────── */

function Measured({
  text,
  language,
  estimated,
}: {
  text: string;
  language: string;
  estimated: number;
}): React.ReactElement {
  const [voices, setVoices] = useState<readonly Voice[] | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [playRate, setPlayRate] = useState(1);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const playback = useRef<PlaybackHandle | null>(null);
  const supported = speechSupported();

  // Voices arrive asynchronously in Chrome, so this cannot be read during render.
  useEffect(() => {
    if (!supported) {
      setVoices([]);
      return;
    }
    let live = true;
    void loadVoices().then((list) => {
      if (!live) return;
      setVoices(list);
      const base = language.toLowerCase().split('-')[0] ?? 'en';
      const preferred =
        list.find((voice) => voice.lang.toLowerCase() === language.toLowerCase() && voice.local) ??
        list.find((voice) => voice.lang.toLowerCase().startsWith(base) && voice.local) ??
        list.find((voice) => voice.lang.toLowerCase().startsWith(base)) ??
        list.find((voice) => voice.isDefault) ??
        list[0];
      if (preferred) setVoiceName(preferred.name);
    });
    return () => {
      live = false;
    };
  }, [language, supported]);

  // Anything speaking when the island unmounts keeps speaking: the synthesis
  // queue belongs to the page, not to the component.
  useEffect(
    () => () => {
      playback.current?.stop();
      if (speechSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  const matching = useMemo(() => {
    if (!voices) return [];
    const base = language.toLowerCase().split('-')[0] ?? 'en';
    const hits = voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));
    return hits.length > 0 ? hits : voices;
  }, [voices, language]);

  const measure = useCallback(async () => {
    if (text.trim() === '' || voiceName === '') return;
    setBusy(true);
    setError(null);
    setMeasurement(null);
    try {
      setMeasurement(await measureSpeech({ ...DEFAULT_MEASURE, text, voiceName }));
    } catch (thrown) {
      setError(
        thrown instanceof MeasureError
          ? thrown.message
          : 'The measurement failed for an unknown reason.',
      );
    } finally {
      setBusy(false);
    }
  }, [text, voiceName]);

  const play = useCallback(() => {
    playback.current?.stop();
    setProgress(0);
    playback.current = playSpeech({
      text,
      voiceName,
      rate: playRate,
      onProgress: setProgress,
      onEnd: () => setProgress(null),
      onError: (message) => {
        setError(message);
        setProgress(null);
      },
    });
  }, [playRate, text, voiceName]);

  const stopPlayback = useCallback(() => {
    playback.current?.stop();
    setProgress(null);
  }, []);

  if (!supported) {
    return (
      <Panel title="Measured from a real voice">
        <p className="px-4 py-6 text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">
          This browser has no speech synthesis, so there is nothing to measure. The estimate above
          is all this page can offer here. Chrome, Edge and Safari all support it.
        </p>
      </Panel>
    );
  }

  const voice = voices?.find((entry) => entry.name === voiceName);
  const drift = measurement && estimated > 0 ? (measurement.seconds / estimated - 1) * 100 : null;

  return (
    <Panel
      title="Measured from a real voice"
      aside={
        <div className="flex items-center gap-2">
          {busy && <Badge tone="busy">Probing</Badge>}
          {measurement && (
            <span className="tabular font-mono text-[13px] text-[var(--c-accent)]">
              {formatDuration(measurement.seconds)}
            </span>
          )}
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--c-text-muted)]">
          Speaks the opening at normal speed, watches the engine&rsquo;s own word-boundary events,
          and fits a characters-per-second rate from them. It cancels as soon as the fit is good, so
          the probe takes two to three seconds whether the text is 50 words or 5,000. Speeding the
          probe up would finish sooner and skew the answer long, by 8% at 2.5x and 28% at 4x against
          a stopwatch, so it does not. Volume is zero during the probe: nothing is audible until you
          press Play.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Voice"
            htmlFor="rt-voice"
            hint={
              voices === null
                ? 'Loading the installed voices…'
                : voice
                  ? `${voice.lang} · ${voice.local ? 'on this device' : 'server-side, so timing includes the network'}`
                  : `${matching.length} available`
            }
          >
            <Select
              id="rt-voice"
              value={voiceName}
              onChange={setVoiceName}
              options={matching.map((entry) => ({
                value: entry.name,
                label: `${entry.name} (${entry.lang})`,
              }))}
            />
          </Field>

          <div className="flex items-end">
            <Toolbar>
              <Button
                onClick={measure}
                variant="primary"
                disabled={busy || voiceName === '' || text.trim() === ''}
              >
                {busy ? 'Probing' : 'Measure'}
              </Button>
              {progress === null ? (
                <Button onClick={play} disabled={voiceName === '' || text.trim() === ''}>
                  Play
                </Button>
              ) : (
                <Button onClick={stopPlayback}>Stop</Button>
              )}
            </Toolbar>
          </div>
        </div>

        <Slider
          id="rt-play-rate"
          label="Playback speed"
          value={playRate}
          min={0.5}
          max={4}
          step={0.25}
          suffix="x"
          onChange={setPlayRate}
        />

        {progress !== null && (
          <div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--c-sunken)]">
              <div
                className="h-full bg-[var(--c-accent-fill)] transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-[10.5px] text-[var(--c-text-faint)]">
              {Math.round(progress * 100)}% spoken at {playRate}x
            </p>
          </div>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {measurement && (
        <>
          <StatRow
            columns={5}
            stats={[
              {
                label: 'Measured duration',
                value: formatDuration(measurement.seconds),
                hint: measurement.complete ? 'whole text spoken' : 'fitted from the opening',
                tone: 'accent',
              },
              {
                label: 'Voice rate',
                value: `${Math.round(measurement.wpm)} wpm`,
                hint: `${measurement.charsPerSecond.toFixed(1)} chars/s`,
              },
              {
                label: 'Probe took',
                value: `${(measurement.probeMs / 1000).toFixed(1)} s`,
                hint: `${num(measurement.samples)} events`,
              },
              {
                label: 'Text sampled',
                value: `${(measurement.covered * 100).toFixed(0)}%`,
              },
              {
                label: 'Versus estimate',
                value: drift === null ? '—' : `${drift >= 0 ? '+' : ''}${drift.toFixed(0)}%`,
                tone: drift === null ? 'default' : Math.abs(drift) > 25 ? 'warn' : 'ok',
                hint: formatDuration(estimated),
              },
            ]}
          />

          <div className="border-t border-[var(--c-line)] px-4 py-3">
            <p className="text-[12px] leading-relaxed text-[var(--c-text-muted)]">
              {measurement.complete
                ? 'The whole text was spoken, so this is a measurement rather than a projection.'
                : `Fitted from the first ${(measurement.covered * 100).toFixed(0)}% and scaled to the full length. It assumes the rest speaks at the same rate, which is wrong wherever the register changes: a passage thick with numbers and acronyms takes far longer per character than prose.`}
              {drift !== null && Math.abs(drift) > 25 && (
                <>
                  {' '}
                  The gap against the word-count estimate is large. That usually means this voice is
                  simply fast or slow rather than that either number is wrong, and it is the reason
                  measuring beats estimating.
                </>
              )}
            </p>
            <div className="mt-2.5">
              <CopyButton
                label="Copy summary"
                text={[
                  `words: ${count(text).words}`,
                  `estimated: ${formatDuration(estimated)}`,
                  `measured: ${formatDuration(measurement.seconds)} (${voiceName})`,
                  `voice rate: ${Math.round(measurement.wpm)} wpm, ${measurement.charsPerSecond.toFixed(1)} chars/s`,
                  `probe: ${(measurement.probeMs / 1000).toFixed(1)}s over ${(measurement.covered * 100).toFixed(0)}% of the text`,
                ].join('\n')}
              />
            </div>
          </div>
        </>
      )}

      {voices !== null && voices.length === 0 && (
        <p className="border-t border-[var(--c-line)] px-4 py-3 text-[12px] leading-relaxed text-[var(--c-warn)]">
          The browser reports speech support but no installed voices. On Linux that usually means no
          speech-dispatcher backend is installed; in a headless or private context the list can also
          come back empty.
        </p>
      )}
    </Panel>
  );
}

export { Segmented };
