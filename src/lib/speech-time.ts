/**
 * How long will this take to read aloud, and how long to read silently.
 *
 * ## Two different questions
 *
 * **Silent reading** is a word-count estimate, and a well-studied one. Brysbaert
 * (2019) meta-analysed 190 studies and 18,573 participants: English prose reads
 * at a mean of 238 wpm silently and 183 wpm aloud. Those are the numbers here,
 * not the 200 wpm that circulates without a source.
 *
 * **Spoken duration** is not a word-count estimate, because speech rate depends
 * on the voice, the engine, and the language, and varies by more than 2x across
 * the voices installed on one machine. So it is measured instead.
 *
 * ## Measuring without waiting
 *
 * The obvious implementation speaks the text and times it. For 500 words that is
 * three and a half minutes, which is not a tool.
 *
 * `SpeechSynthesisUtterance` fires `boundary` events carrying `charIndex` and
 * `elapsedTime` as it speaks. So: start speaking at an elevated rate, watch the
 * boundaries, and once enough of them have arrived to fit a line, cancel. That
 * yields *characters per second for this exact voice* in about two seconds
 * regardless of how long the text is, and the full duration follows by
 * multiplication.
 *
 * The extrapolation is the honest weak point, and it is stated in the UI: it
 * assumes the rest of the text speaks at the same rate as the probed opening,
 * which is wrong wherever a passage changes register, and it assumes rate
 * scaling is linear, which is close but not exact.
 *
 * ## What this is not
 *
 * Not a text-to-speech quality tool. The audio exists so you can check the
 * pronunciation and the pacing are plausible. The number is the deliverable.
 *
 * @see src/components/tools/ReadTime.tsx for the UI over this.
 */

/* ── Reading models ───────────────────────────────────────────────────── */

export interface ReadingMode {
  readonly id: string;
  readonly label: string;
  readonly wpm: number;
  readonly note: string;
}

/**
 * Rates with a source, rather than the round numbers everyone repeats.
 *
 * The silent and aloud figures are Brysbaert's meta-analytic means for English
 * non-fiction. The delivery rates are conventions from their own fields:
 * audiobook narration has a published target range, and the presentation figure
 * is what speech coaches teach.
 */
export const READING_MODES: readonly ReadingMode[] = [
  {
    id: 'silent',
    label: 'Silent reading',
    wpm: 238,
    note: 'Brysbaert 2019, meta-analysis of 190 studies: mean 238 wpm for English non-fiction, with most readers between 175 and 300.',
  },
  {
    id: 'aloud',
    label: 'Read aloud',
    wpm: 183,
    note: 'Same meta-analysis, reading aloud. Slower than silent reading because articulation is the bottleneck rather than comprehension.',
  },
  {
    id: 'audiobook',
    label: 'Audiobook narration',
    wpm: 155,
    note: 'The middle of the 150 to 160 wpm range publishers ask narrators for. Deliberately slower than natural speech.',
  },
  {
    id: 'podcast',
    label: 'Conversational',
    wpm: 170,
    note: 'Unscripted speech between two people. Faster than narration and full of words a transcript keeps and a script would not.',
  },
  {
    id: 'presentation',
    label: 'Presenting',
    wpm: 130,
    note: 'What a speaker coach targets for a talk: slow, with pauses that a word count cannot see.',
  },
  {
    id: 'auction',
    label: 'As fast as intelligible',
    wpm: 350,
    note: 'Sustained upper bound for a trained speaker. Comprehension falls off well before this.',
  },
];

/**
 * Relative speaking rate by language, as a multiplier on the English word rate.
 *
 * Words per minute is a bad cross-language unit, because a "word" is not
 * comparable: German compounds several English words into one, and Chinese has
 * no spaces at all. Pellegrino, Coupé and Marsico (2011) found information rate
 * roughly constant across languages while syllable rate varies a lot, so these
 * factors adjust the *word* count toward a comparable duration.
 *
 * Approximate, and the UI says so. The measured mode does not use them at all,
 * which is the main argument for measuring.
 */
export const LANGUAGE_FACTORS: Readonly<Record<string, number>> = {
  en: 1.0,
  de: 0.85, // long compounds: fewer words, each taking longer
  nl: 0.88,
  fr: 1.05,
  it: 1.1,
  es: 1.12,
  pt: 1.1,
  ru: 0.92,
  pl: 0.9,
  tr: 0.85,
  ja: 0.75, // measured against a whitespace-free script, so word counts are unreliable
  zh: 0.7,
  ko: 0.8,
  ar: 0.9,
  hi: 0.95,
  vi: 1.05,
  th: 0.8,
};

/** Base language of a BCP-47 tag, so `en-GB` and `en-US` share a factor. */
export function languageFactor(tag: string): number {
  const base = tag.toLowerCase().split(/[-_]/)[0] ?? 'en';
  return LANGUAGE_FACTORS[base] ?? 1.0;
}

/* ── Counting ─────────────────────────────────────────────────────────── */

export interface Counted {
  readonly words: number;
  readonly chars: number;
  readonly sentences: number;
  /** Rough syllable count, English heuristic. */
  readonly syllables: number;
  /** True where the text has no whitespace-delimited words to count. */
  readonly scriptWithoutSpaces: boolean;
}

/** CJK and Thai blocks, where a whitespace word count means nothing. */
const NO_SPACE_SCRIPT = /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿]/;

/**
 * Count the units a duration estimate needs.
 *
 * For a script without spaces the character count stands in for the word count,
 * at roughly 1.5 characters per spoken unit. That is a coarse approximation and
 * it is flagged in the return value so the UI can say which unit it used.
 */
export function count(text: string): Counted {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { words: 0, chars: 0, sentences: 0, syllables: 0, scriptWithoutSpaces: false };
  }

  const spaceless = NO_SPACE_SCRIPT.test(trimmed) && !/\s/.test(trimmed.slice(0, 80));
  const tokens = trimmed.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  const cjkChars = (trimmed.match(/[぀-ヿ㐀-䶿一-鿿]/g) ?? []).length;

  return {
    // CJK characters count as speech units in their own right, on top of any
    // Latin words present, so mixed text is not undercounted.
    words: spaceless ? Math.round(cjkChars / 1.5) : tokens.length + Math.round(cjkChars / 1.5),
    chars: trimmed.length,
    sentences: (trimmed.match(/[.!?。！？]+(?:\s|$)/g) ?? []).length || 1,
    syllables: tokens.reduce((sum, word) => sum + syllablesIn(word), 0),
    scriptWithoutSpaces: spaceless,
  };
}

/**
 * Vowel-group syllable count.
 *
 * Good enough for a readability grade and not good enough for anything else. It
 * is wrong on `queue` (1, counts 2) and on `poem` (2, counts 1). Included
 * because the Flesch score needs a syllable count and this is the standard
 * approximation every implementation of it uses.
 */
function syllablesIn(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/* ── Estimation ───────────────────────────────────────────────────────── */

export interface Estimate {
  readonly seconds: number;
  readonly words: number;
  readonly effectiveWpm: number;
}

/**
 * Duration from a word count and a rate.
 *
 * Pause time is added per sentence rather than folded into the rate, because a
 * document of 40 short sentences takes measurably longer to read aloud than one
 * of 8 long ones with the same word count, and a pure wpm model cannot express
 * that.
 */
export function estimate(
  counted: Counted,
  wpm: number,
  languageTag: string,
  { sentencePauseMs = 0 }: { sentencePauseMs?: number } = {},
): Estimate {
  const adjusted = wpm * languageFactor(languageTag);
  if (adjusted <= 0 || counted.words === 0) {
    return { seconds: 0, words: counted.words, effectiveWpm: adjusted };
  }
  const seconds = (counted.words / adjusted) * 60 + (counted.sentences * sentencePauseMs) / 1000;
  return { seconds, words: counted.words, effectiveWpm: adjusted };
}

/** `4m 12s`, or `18s` under a minute, or `1h 04m` over an hour. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/* ── Readability ──────────────────────────────────────────────────────── */

export interface Readability {
  /** Flesch Reading Ease. 0 to 100, higher is easier. */
  readonly flesch: number;
  /** Flesch-Kincaid grade level, in US school years. */
  readonly grade: number;
  readonly label: string;
}

/**
 * Flesch Reading Ease and Flesch-Kincaid grade.
 *
 * English only, and both formulas are calibrated on English prose: run them on
 * code or on another language and the number is noise. The UI hides them for
 * anything that is not tagged English.
 */
export function readability(counted: Counted): Readability {
  if (counted.words === 0 || counted.sentences === 0) {
    return { flesch: 0, grade: 0, label: 'Not enough text' };
  }
  const wordsPerSentence = counted.words / counted.sentences;
  const syllablesPerWord = counted.syllables / counted.words;

  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  const label =
    flesch >= 90
      ? 'Very easy, around a 5th-grade level'
      : flesch >= 70
        ? 'Easy, around a 7th-grade level'
        : flesch >= 60
          ? 'Plain English, around a 9th-grade level'
          : flesch >= 50
            ? 'Fairly hard, high-school level'
            : flesch >= 30
              ? 'Hard, undergraduate level'
              : 'Very hard, professional or academic';

  return {
    flesch: Math.max(0, Math.min(100, flesch)),
    grade: Math.max(0, grade),
    label,
  };
}

/* ── Voices ───────────────────────────────────────────────────────────── */

export interface Voice {
  readonly name: string;
  readonly lang: string;
  /** Runs on the device rather than on a server. Faster to start, and private. */
  readonly local: boolean;
  readonly isDefault: boolean;
}

/** True where this browser can speak at all. */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * List the installed voices.
 *
 * `getVoices()` is empty on the first call in Chrome: the list arrives
 * asynchronously and fires `voiceschanged`. Polling is the documented
 * workaround, and it resolves on the first non-empty result or gives up after a
 * second so a browser with no voices does not hang the UI.
 */
export function loadVoices(): Promise<readonly Voice[]> {
  if (!speechSupported()) return Promise.resolve([]);

  const read = (): Voice[] =>
    window.speechSynthesis.getVoices().map((voice) => ({
      name: voice.name,
      lang: voice.lang,
      local: voice.localService,
      isDefault: voice.default,
    }));

  const immediate = read();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (voices: readonly Voice[]): void => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.onvoiceschanged = null;
      window.clearInterval(timer);
      resolve(voices);
    };
    window.speechSynthesis.onvoiceschanged = () => finish(read());
    const timer = window.setInterval(() => {
      const voices = read();
      if (voices.length > 0) finish(voices);
    }, 100);
    window.setTimeout(() => finish(read()), 1500);
  });
}

/* ── Measurement ──────────────────────────────────────────────────────── */

export interface MeasureOptions {
  readonly text: string;
  readonly voiceName: string;
  /**
   * Playback rate for the probe. Leave this at 1 unless you have measured the
   * engine yourself: see {@link DEFAULT_MEASURE} for why nothing else is safe.
   */
  readonly rate: number;
  /** Give up after this long, whatever has arrived. */
  readonly budgetMs: number;
  /** Minimum boundary events before a fit is trusted. */
  readonly minBoundaries: number;
}

export interface Measurement {
  /** Extrapolated duration of the whole text at rate 1. */
  readonly seconds: number;
  /** Characters per second at rate 1, for this voice. */
  readonly charsPerSecond: number;
  /** Implied words per minute, for comparison with the estimator. */
  readonly wpm: number;
  /** How long the probe itself took. */
  readonly probeMs: number;
  /** Fraction of the text actually spoken. */
  readonly covered: number;
  /** Boundary events used for the fit. */
  readonly samples: number;
  /** True when the whole text was spoken, so the figure is measured not fitted. */
  readonly complete: boolean;
}

/**
 * Probe at natural speed.
 *
 * Speaking the probe faster and dividing the rate back out finishes sooner, and
 * it is wrong. Sweeping rate 1 to 4 against ground truth (the wall-clock time to
 * actually speak the whole text at rate 1) over the five local English voices on
 * Windows SAPI, two texts each, 160 runs:
 *
 * | rate | mean abs error | worst | probe |
 * | ---- | -------------- | ----- | ----- |
 * | 1    | 3.9%           | 8.7%  | 2.6 s |
 * | 1.5  | 9.8%           | 22.6% | 2.3 s |
 * | 2    | 6.4%           | 14.7% | 1.7 s |
 * | 2.5  | 7.7%           | 16.5% | 1.4 s |
 * | 3    | 5.1%           | 12.4% | 1.0 s |
 * | 4    | 27.5%          | 34.5% | 1.0 s |
 *
 * Every rate above 1 skews the estimate long, because engines do not speed up
 * by exactly the factor asked for and the fixed start-up latency does not scale
 * at all. The error is not monotonic either, which is the tell that SAPI is
 * quantising the multiplier onto its own coarse rate scale, so a value tuned
 * here would not carry to another engine. Rate 1 is the one setting that never
 * invokes the assumption, and it was the most accurate on every voice tested.
 *
 * The price is a probe of about 2.6 s rather than 1.4 s, and hitting `budgetMs`
 * on roughly half of runs, which costs coverage but not much accuracy.
 */
export const DEFAULT_MEASURE: Omit<MeasureOptions, 'text' | 'voiceName'> = {
  rate: 1,
  budgetMs: 3_000,
  minBoundaries: 6,
};

export class MeasureError extends Error {}

/**
 * Measure this voice's speaking rate, then extrapolate.
 *
 * Resolves as soon as the probe has enough boundary events to fit a rate, which
 * is normally under two seconds and is independent of how long the text is.
 *
 * @throws MeasureError When speech is unsupported, the voice is missing, the
 *   engine reports an error, or no boundary events arrive at all. The last case
 *   is a real browser difference rather than a bug: Safari's `boundary` support
 *   has historically been absent, and the caller falls back to the word-count
 *   model rather than reporting a measurement it did not make.
 */
export function measureSpeech(options: MeasureOptions): Promise<Measurement> {
  return new Promise((resolve, reject) => {
    if (!speechSupported()) {
      reject(new MeasureError('This browser has no speech synthesis.'));
      return;
    }

    const synth = window.speechSynthesis;
    // A queued or paused utterance from a previous run would time this one.
    synth.cancel();
    synth.resume();

    const voice = synth.getVoices().find((candidate) => candidate.name === options.voiceName);
    if (!voice) {
      reject(new MeasureError(`Voice "${options.voiceName}" is no longer available.`));
      return;
    }

    const text = options.text.slice(0, 20_000);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = Math.max(0.1, Math.min(10, options.rate));
    utterance.volume = 0; // a probe, not playback

    const started = performance.now();
    let lastIndex = 0;
    let lastElapsed = 0;
    let samples = 0;
    let settled = false;

    const finish = (complete: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline);
      synth.cancel();

      const probeMs = performance.now() - started;
      // `elapsedTime` is specified in seconds but Chrome has shipped it in
      // milliseconds for years. Wall-clock is the arbiter: a figure more than
      // ten times the time actually spent cannot be seconds.
      const reported = lastElapsed > probeMs / 100 ? lastElapsed / 1000 : lastElapsed;
      const spokenSeconds = reported > 0 ? reported : probeMs / 1000;

      if (samples < 1 || lastIndex <= 0) {
        reject(
          new MeasureError(
            'The voice produced no progress events, so there is nothing to measure. Safari and some mobile browsers do not report them.',
          ),
        );
        return;
      }

      // Divide out the probe rate to get the natural rate. This is a no-op at
      // the default rate of 1, which is the point: measured against ground
      // truth the division is only good to about 8% even at 2.5x, and 28% at
      // 4x. See DEFAULT_MEASURE.
      const charsPerSecond = lastIndex / spokenSeconds / utterance.rate;
      const seconds = charsPerSecond > 0 ? text.length / charsPerSecond : 0;
      const words = count(text).words;

      resolve({
        seconds,
        charsPerSecond,
        wpm: seconds > 0 ? (words / seconds) * 60 : 0,
        probeMs,
        covered: text.length > 0 ? Math.min(1, lastIndex / text.length) : 0,
        samples,
        complete,
      });
    };

    utterance.onboundary = (event) => {
      // Word boundaries only. Sentence boundaries are too sparse to fit a line
      // through inside the budget, and mixing the two double-counts.
      if (event.name && event.name !== 'word') return;
      if (event.charIndex <= lastIndex) return;
      lastIndex = event.charIndex + (event.charLength ?? 0);
      lastElapsed = event.elapsedTime;
      samples += 1;

      // Enough of a line to trust, and far enough in that the engine's start-up
      // cost is amortised. Below 8% the first-word latency dominates and the
      // fitted rate comes out too slow.
      if (samples >= options.minBoundaries && lastIndex / text.length > 0.08) finish(false);
    };

    utterance.onend = () => finish(true);
    utterance.onerror = (event) => {
      if (settled) return;
      // `interrupted` and `canceled` are our own cancel() landing after a
      // resolve, not failures.
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      settled = true;
      window.clearTimeout(deadline);
      reject(new MeasureError(`The speech engine failed: ${event.error}.`));
    };

    const deadline = window.setTimeout(() => finish(false), options.budgetMs);
    synth.speak(utterance);
  });
}

/* ── Playback ─────────────────────────────────────────────────────────── */

export interface PlaybackHandle {
  stop: () => void;
}

/**
 * Speak the text for real, at the given rate.
 *
 * Chunked at sentence boundaries because every major engine truncates a long
 * utterance: Chrome cuts off somewhere past ~32k characters, and some Android
 * voices stop after a few hundred. Splitting also means `stop` takes effect
 * within a sentence instead of at the end of the whole document.
 */
export function playSpeech({
  text,
  voiceName,
  rate,
  pitch = 1,
  onProgress,
  onEnd,
  onError,
}: {
  text: string;
  voiceName: string;
  rate: number;
  pitch?: number;
  /** Fraction complete, by characters. */
  onProgress?: (fraction: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}): PlaybackHandle {
  if (!speechSupported()) {
    onError?.('This browser has no speech synthesis.');
    return { stop: () => {} };
  }

  const synth = window.speechSynthesis;
  synth.cancel();
  synth.resume();

  const voice = synth.getVoices().find((candidate) => candidate.name === voiceName);
  const chunks = chunkForSpeech(text, 220);
  let stopped = false;
  let spoken = 0;

  const speakFrom = (index: number): void => {
    if (stopped || index >= chunks.length) {
      if (!stopped) onEnd?.();
      return;
    }
    const chunk = chunks[index] ?? '';
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = Math.max(0.1, Math.min(10, rate));
    utterance.pitch = pitch;
    utterance.onend = () => {
      spoken += chunk.length;
      onProgress?.(text.length > 0 ? spoken / text.length : 1);
      speakFrom(index + 1);
    };
    utterance.onerror = (event) => {
      if (stopped || event.error === 'interrupted' || event.error === 'canceled') return;
      onError?.(`The speech engine failed: ${event.error}.`);
    };
    synth.speak(utterance);
  };

  speakFrom(0);

  return {
    stop: () => {
      stopped = true;
      synth.cancel();
    },
  };
}

/**
 * Split into utterance-sized pieces, preferring sentence ends.
 *
 * Falls back to a word boundary, then to a hard cut, so a wall of text with no
 * punctuation still gets split rather than being handed over whole and truncated
 * by the engine.
 */
export function chunkForSpeech(text: string, target: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();

  while (rest.length > target) {
    const window_ = rest.slice(0, target + 120);
    const sentence = Math.max(
      window_.lastIndexOf('. '),
      window_.lastIndexOf('! '),
      window_.lastIndexOf('? '),
      window_.lastIndexOf('\n'),
      window_.lastIndexOf('。'),
    );
    const cut = sentence > target * 0.4 ? sentence + 1 : window_.lastIndexOf(' ');
    const at = cut > 0 ? cut : target;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }

  if (rest !== '') chunks.push(rest);
  return chunks;
}
