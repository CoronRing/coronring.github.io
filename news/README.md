# NewsRing subscriptions

The public mailing list for [NewsRing](https://github.com/CoronRing/NewsRing)'s daily AI digest. It takes signups from the site, confirms them, holds the list, and mails each morning's digest when NewsRing says a new one is published.

It is the third service on the Oracle host, beside the particle-wave converter and the site-chat assistant, and it is mounted at `/news`.

## What it is and is not

Everyone on the list gets the **same** digest, the one written for the author's own profile. There is no per-reader selection here, no profile and no model call: one document is fetched from the published site, one string is substituted per reader (their unsubscribe link), and the rest is SMTP. That is what keeps this small enough to sit on a free-tier box next to two other services.

It is also the only part of the whole NewsRing system that knows who reads it. The NewsRing repository is public and its CI logs are public, so no address is ever in it.

## Routes

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness, which variables are unset, list size, the digest it can see |
| `GET /api/status` | Everything health reports, plus counters |
| `POST /api/subscribe` | An address in, a confirmation mail out. **Stores nothing.** |
| `GET /api/confirm` | A signed link: joins the list and sends today's digest at once |
| `GET /api/unsubscribe` | A signed link: leaves the list, address deleted |
| `POST /api/unsubscribe` | The same, for one-click unsubscribe in a mail client |
| `POST /api/broadcast` | Bearer token: today's digest to everyone who has not had it |

From outside, these are `https://<host>/news/api/...`.

## Why confirmed opt-in

Anyone can type anyone's address into a form. Without a confirmation step this service would mail a stranger daily on a stranger's say-so, and the sending mailbox would wear the consequences. Confirmation also lets the address ride in the signed link rather than a table, so an unconfirmed signup leaves no record at all and this endpoint cannot be used to collect addresses.

Three more controls sit behind it: a per-address cooldown (the one that stops an inbox being bombed), a per-caller rate limit, and a daily ceiling on confirmation mail. A honeypot field catches ordinary form-filling bots, and is answered exactly like a real signup so the next bot is no smarter.

## Why the list is capped

`NEWS_MAX_SUBSCRIBERS` defaults to 50. The mailbox behind this is an ordinary consumer account with a daily cap in the hundreds and a reputation that a daily bulk send to strangers will spend. The cap is low enough that the list cannot grow into that wall unnoticed. **Raising it is a decision to move to a real sending service first**, which in turn needs a domain to verify.

## Configuration

Everything is an environment variable. The deployed values are in `infra/compose.yml`, and the secrets are written to `news.env` on the host by `infra/configure.py`.

| Variable | Default | Notes |
|---|---|---|
| `NEWS_TOKEN_SECRET` | — | **Required.** Signs confirm and unsubscribe links. Rotating it invalidates every outstanding link. |
| `NEWS_BROADCAST_TOKEN` | — | **Required.** What `POST /api/broadcast` demands. NewsRing's workflow holds the same value. |
| `NEWS_DIGEST_URL` | — | **Required.** NewsRing's `broadcast_today.json`. |
| `NEWS_SMTP_USER` / `NEWS_SMTP_PASSWORD` | — | **Required.** Mailbox and app password. |
| `NEWS_SMTP_HOST` / `NEWS_SMTP_PORT` | `smtp.gmail.com` / `587` | Port 465 switches to implicit TLS. |
| `NEWS_MAIL_FROM` | `NEWS_SMTP_USER` | Header and envelope sender. |
| `NEWS_MAIL_FROM_NAME` | `NewsRing` | |
| `NEWS_MAIL_REPLY_TO` | unset | |
| `NEWS_PUBLIC_BASE` | — | This service's public URL **including** `/news`. Links in email are built from it; it cannot be inferred, because Caddy strips the prefix. |
| `NEWS_SITE_URL` | the signup page | Where confirm and unsubscribe redirect to. |
| `NEWS_SUPABASE_URL` | unset | The Postgres project holding the list, e.g. `https://abcdefgh.supabase.co`. Must be `https`. |
| `NEWS_SUPABASE_KEY` | unset | That project's **service-role** key. Bypasses row-level security, so it stays on the host and never reaches a browser. |
| `NEWS_SUPABASE_TABLE` | `newsring_subscribers` | |
| `NEWS_SUPABASE_TIMEOUT_S` | `10` | Per attempt; three attempts per call. |
| `NEWS_DATABASE_PATH` | `/data/news.db` | The local fallback, used only when the two Supabase variables are not both set. |
| `NEWS_MAX_SUBSCRIBERS` | `50` | |
| `NEWS_CONFIRM_TTL_S` | `172800` | 48 hours. |
| `NEWS_ADDRESS_COOLDOWN_S` | `900` | One confirmation per address per window. |
| `NEWS_MAX_CONFIRM_PER_DAY` | `100` | Global backstop. |
| `NEWS_RATE_LIMIT_PER_MIN` / `_BURST` | `3` / `3` | Per caller. |
| `NEWS_ALLOWED_ORIGINS` | same-origin only | The site, and the Astro dev server. |
| `NEWS_DIGEST_CACHE_S` | `300` | A broadcast always refetches. |

With any required variable unset the service starts, answers `degraded`, names what is missing, and refuses every endpoint. A container that will not boot tells an operator far less.

## The data

One table, one row per confirmed reader: address, when they joined, and the date of the last digest they were sent. That last column is what makes a re-run of the workflow harmless — the broadcast asks for everyone whose last date is not today's, so a workflow dispatched twice mails nobody twice.

It is the only state in this deployment that cannot be rebuilt from the repository, and you do not get to ask people to subscribe twice. So it does not live on the host. The host is a free-tier box that its provider can reclaim without notice, disks and named volumes included, and that has already happened here once. The list lives in Postgres instead, in the site's own Supabase project, and the box stays disposable.

The table is `public.newsring_subscribers`, created by `supabase/migrations/` at the repository root. The project offers four keys, and `NEWS_SUPABASE_KEY` must be the legacy `service_role` one: as of November 2026 the newer `secret` key is listed but answers 401 on this project, so it is not a drop-in replacement yet. Supabase intends to retire the legacy pair, so expect to swap this once the new key works — the only change is the value of that one variable. The project is the site's rather than this service's: one database for whatever the site comes to keep, with each table named for the project that owns it. Row-level security is on with no policies at all, which denies every anon and authenticated caller outright while the service-role key this backend holds bypasses it. Verified rather than assumed: with the publishable key a select returns `[]` and an insert is refused with `42501`, so the key that ships in a browser bundle cannot read the list even if it leaks.

SQLite remains for the tests and for a local run, where a network database would mean every test needed credentials and an internet connection. `GET /api/health` reports which backend actually answered, under `store`, so a deployment that quietly fell back to local disk is visible rather than discovered later.

### When the database is unreachable

It is across the internet now, so it can fail, and each endpoint fails in the way that costs the reader least:

| | What happens |
|---|---|
| `/api/health` | Still answers 200, with `store.reachable: false` and `status: degraded`. A health check that dies with its dependency cannot tell you which one broke. |
| `POST /api/subscribe` | 503, and the form says to try again shortly. |
| `GET /api/confirm` | Redirects to the signup page with `?state=error`. Nothing is claimed; the link is stateless and still valid for its full 48 hours. |
| `GET /api/unsubscribe` | The same. An unsubscribe is never reported as done when it was not — somebody told they are off the list and then sent tomorrow's digest reports it as spam rather than clicking again. |
| `POST /api/unsubscribe` | 503, so the mail provider retries. The one-click endpoint's usual "always answer 200" does not apply when the removal did not happen. |
| `POST /api/broadcast` | 503. If the failure comes from recording a send rather than reading the list, the send stops there: carrying on would mail the rest of the list without being able to record it, and the re-run would then send every one of them the same digest twice. |

## Running it locally

```bash
uv venv
uv pip install -r requirements.txt pytest httpx
.venv/Scripts/python.exe -m pytest
```

The tests replace the mailer and the digest fetch, so nothing is sent and nothing is fetched. What they check is who gets mail, what headers it carries, and what the service refuses.

## Checking it against the real thing

```bash
.venv/Scripts/python.exe live_check.py --no-mail
```

```bash
.venv/Scripts/python.exe live_check.py
```

`live_check.py` runs the actual service on localhost and walks one reader through the whole journey: signup, confirmation, the welcome digest, a broadcast that skips a reader who already has today's digest, a broadcast that sends to one who does not, an unsubscribe, a second click on the same link, and a forged token. It runs in the same environment as the tests above, `httpx` included, and reads credentials from the environment or from the operator's `.env` — the same file `infra/configure.py` reads, parsed by the same rule.

It exists because the suite above is blind in one place. A stand-in database has no opinion about whether a query is well formed and a stand-in mailer never logs in, so neither can fail the way the real ones do. Two bugs have lived in exactly that gap: a filter that matched no rows and reported success, which made an unsubscribe a no-op that told the reader otherwise; and a password that reached the host with the `.env` comment still attached, which the provider answers with `535` and the service reports as a type name. Both passed every unit test.

What a run costs: it writes to the live table, and without `--no-mail` it sends three real messages. The subscriber it creates is the sending mailbox's own `+newsring-e2e` tag, so the mail lands back where it came from, and the row is deleted again even when a check fails. **It will not broadcast while anyone else is on the list** — a broadcast goes to every reader who has not had today's digest, so on a populated list those two steps are skipped with a note rather than mailing real people because someone ran a test.
