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
| `NEWS_DATABASE_PATH` | `/data/news.db` | On a named volume. |
| `NEWS_MAX_SUBSCRIBERS` | `50` | |
| `NEWS_CONFIRM_TTL_S` | `172800` | 48 hours. |
| `NEWS_ADDRESS_COOLDOWN_S` | `900` | One confirmation per address per window. |
| `NEWS_MAX_CONFIRM_PER_DAY` | `100` | Global backstop. |
| `NEWS_RATE_LIMIT_PER_MIN` / `_BURST` | `3` / `3` | Per caller. |
| `NEWS_ALLOWED_ORIGINS` | same-origin only | The site, and the Astro dev server. |
| `NEWS_DIGEST_CACHE_S` | `300` | A broadcast always refetches. |

With any required variable unset the service starts, answers `degraded`, names what is missing, and refuses every endpoint. A container that will not boot tells an operator far less.

## The data

One SQLite file on a named volume, one table, one row per confirmed reader: address, when they joined, and the date of the last digest they were sent. That last column is what makes a re-run of the workflow harmless.

It is the only state in this deployment that cannot be rebuilt from the repository. Losing the volume means everyone has to subscribe again.

## Running it locally

```bash
uv venv
uv pip install -r requirements.txt pytest httpx
.venv/Scripts/python.exe -m pytest
```

The tests replace the mailer and the digest fetch, so nothing is sent and nothing is fetched. What they check is who gets mail, what headers it carries, and what the service refuses.
