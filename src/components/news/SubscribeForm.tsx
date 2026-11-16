import { useEffect, useId, useState, type FormEvent } from 'react';
import { subscribe, type SubscribeOutcome } from '../../lib/newsring-api';

/**
 * The NewsRing signup form.
 *
 * One field and one button, because that is the whole interaction: everyone
 * on the list gets the same digest, so there is nothing to configure at
 * signup. What the visitor needs to know before typing — one email a morning,
 * the same one for everyone, unsubscribe in one click — is said beside it
 * rather than discovered afterwards.
 *
 * Nothing is stored when this submits. The service mails a confirmation link
 * and keeps no record until it is clicked, which is why the success state says
 * "check your inbox" rather than "you are subscribed".
 *
 * ## The hidden field
 *
 * `website` is a honeypot: positioned off-screen, excluded from the tab order,
 * and marked `aria-hidden`, so no person and no screen reader ever meets it,
 * while an ordinary form-filling bot fills it in. The server answers a
 * request carrying it exactly like a good one.
 */

interface Props {
  /** Which surface this instance sits on, recorded with the signup. */
  source?: string;
  /** Tightens the layout for the demo frame, where vertical space is short. */
  compact?: boolean;
}

type State = { phase: 'idle' | 'sending' } | { phase: 'done'; outcome: SubscribeOutcome };

/** Enough to catch a typo before a round trip. The server decides properly. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export default function SubscribeForm({ source = 'site', compact = false }: Props) {
  const fieldId = useId();
  const honeypotId = useId();
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [touched, setTouched] = useState(false);

  // A new address means the previous answer no longer describes what is on
  // screen, so it goes rather than sitting under a field that has moved on.
  useEffect(() => {
    setState((current) => (current.phase === 'done' ? { phase: 'idle' } : current));
  }, [email]);

  const invalid = touched && email.trim() !== '' && !looksLikeEmail(email);
  const sending = state.phase === 'sending';

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTouched(true);
    if (!looksLikeEmail(email) || sending) return;
    setState({ phase: 'sending' });
    const outcome = await subscribe(email.trim(), { source, honeypot });
    setState({ phase: 'done', outcome });
    if (outcome.kind === 'pending') setEmail('');
  }

  const answer = state.phase === 'done' ? state.outcome : null;
  const tone =
    answer === null
      ? ''
      : answer.kind === 'pending'
        ? 'text-ok'
        : answer.kind === 'full'
          ? 'text-warn'
          : 'text-danger';

  return (
    <form onSubmit={onSubmit} noValidate className={compact ? '' : 'max-w-xl'}>
      <label htmlFor={fieldId} className="eyebrow block">
        Your email
      </label>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={fieldId}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          disabled={sending}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={invalid || undefined}
          aria-describedby={`${fieldId}-note`}
          className="min-w-0 flex-1 border border-[var(--c-line)] bg-[var(--c-sunken)] px-3 py-2.5 text-[15px] text-[var(--c-text)] focus:border-[var(--c-accent)] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending}
          className="border-fg hover:bg-fg hover:text-ground border px-4 py-2.5 font-mono text-xs tracking-wide uppercase transition-colors disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Get the digest'}
        </button>
      </div>

      {/*
        Off-screen rather than `display:none`: some bots skip hidden inputs but
        fill positioned ones, and a visitor never reaches it either way.
      */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={honeypotId}>Website</label>
        <input
          id={honeypotId}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      <p id={`${fieldId}-note`} className="text-faint mt-3 text-[13px] leading-relaxed">
        One email each morning, the same digest for everyone. You will get a link to confirm first —
        nothing is stored until you click it — and every email has a one-click unsubscribe.
      </p>

      {invalid && (
        <p className="text-warn mt-2 font-mono text-[12px]">That does not look like an address.</p>
      )}

      <p aria-live="polite" className={`mt-2 text-[13px] leading-relaxed ${tone}`}>
        {answer?.message ?? ''}
      </p>
    </form>
  );
}
