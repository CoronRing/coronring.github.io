# site-chat service

Answers questions about coronring.github.io from the site's own text.

The whole site is about **four thousand tokens**. That single fact decides the
architecture: there is no retrieval step, no chunking, and no vector database.
Every question is answered against the _complete_ text of every page.

That is the highest-quality option available — the model can never miss a
relevant passage because a retriever ranked it eighth — and, because the text is
byte-identical on every request, it is also the cheapest. The provider's
implicit cache absorbs the repeated prefix.

## How the corpus gets here

```
src/pages/*.astro ─→ astro build ─→ dist/*.html
                                      │
                          scripts/build-corpus.mjs  (astro:build:done)
                                      │
                                      ├─→ dist/corpus.json   ← this service reads it
                                      ├─→ dist/llms.txt
                                      └─→ dist/llms-full.txt
```

The corpus is extracted from the **built HTML**, not from the content
collections, because a good half of the site's prose lives in `.astro` templates
rather than in a collection. Extracting from `dist/` means the corpus is by
construction exactly what a visitor can read, and a page added later is picked
up with no registration step.

The service **fetches** `corpus.json` from the published site and re-checks it
every 15 minutes with an `ETag`. Publishing an article therefore updates the
assistant with no backend redeploy, and the two can never drift.

## Model routing

Requests walk a chain, model-major and key-minor:

| Rung | Model                    | Why                                            |
| ---- | ------------------------ | ---------------------------------------------- |
| 1    | `gemini-3.7-flash`       | The quality target                             |
| 2    | `gemini-3.6-flash`       |                                                |
| 3    | `gemini-3.5-flash`       | Measured fastest and most reliable             |
| 4    | `gemini-3-flash-preview` | Nearest full-size flash to the requested "3.1" |
| 5    | `gemini-3.5-flash-lite`  | Last resort — answering beats not answering    |
| 6    | `gemini-3.1-flash-lite`  | Extra headroom                                 |

Every key is tried on a model before the next model is considered, so a busy
model costs latency rather than an answer.

### Measurements that shaped this

Taken 2026-08-18 against the deployed free-tier keys, five calls each:

| Model              | Latency   | Success | Implicit cache     |
| ------------------ | --------- | ------- | ------------------ |
| `gemini-3.5-flash` | 2.7–4.0 s | 5/5     | **41 % of prompt** |
| `gemini-3.6-flash` | 4–40 s    | 4/5     | 0 %                |
| `gemini-3.7-flash` | 0.8–77 s  | 2/5     | 0 %                |

### The caching result is the important one

Only `gemini-3.5-flash` engaged the implicit cache. `gemini-3.6-flash` and
`gemini-3.7-flash` reported `cachedContentTokenCount: 0` on **every** call,
including consecutive calls with a byte-identical prefix on the same key —
the exact condition the cache exists for. Production agrees: 34,125 prompt
tokens across seven answers on the 3.7/3.6 chain, 0 served from cache.

So the two goals are in tension. `gemini-3.7-flash` at the head of the chain
means the prompt cache never fires, and the repeated corpus is paid for in
full on every request. `gemini-3.5-flash` at the head means ~41 % of the
prompt is free, answers arrive in a third of the time — and the model is a
generation older.

This is a deployment decision, not a code one, which is why the chain is a
single environment variable.

Two consequences are baked into the defaults:

- **Transient cooldowns escalate.** A fixed short cooldown means a
  broadly-overloaded model is retried on essentially every request, and each
  retry costs a visitor most of a minute.
- **`request_timeout_s` is a socket timeout, so it applies per read.** Measured
  inter-frame gaps on a healthy `gemini-3.7-flash` stream reach **12 seconds**,
  so a tight budget risks expiring mid-answer. A truncated answer is worse for a
  visitor than a slow one, so the budget is generous and the cooldowns above are
  what keep a flapping model out of rotation.
- **A stream that ends without a `finishReason` is treated as truncated.** It is
  otherwise indistinguishable from success: the loop exits normally, nothing
  raises, and the fragment reads fine until the last sentence. In production this
  cached "…project page, it" as the canonical answer to a question.

To trade the newest model for speed and a working prompt cache:

```
CHAT_MODELS=gemini-3.5-flash,gemini-3.7-flash,gemini-3.6-flash
```

Set it in `infra/compose.yml` under the `chat` service and redeploy. Nothing
else changes — the chain is read at startup and the corpus, prompt, and cache
behaviour are identical either way.

## Caching, at three levels

1. **The provider's implicit cache.** The system instruction and corpus are
   byte-identical on every request and sent as the prefix, so the provider
   serves the repeat from cache. Measured at 41 % of the prompt on a warm pair.
   Explicit caching (`cachedContents`) was tested and is **unavailable** — the
   free tier reports `limit=0` for cached-content storage.
2. **A local answer cache.** First-turn questions only, keyed on the normalized
   question plus the corpus hash. On a personal site the same handful of
   questions arrive over and over, and the free tier's binding constraint is
   requests per minute.
3. **`ETag` on the corpus fetch.** An unchanged site costs a 304.

The one number worth watching is `prompt_cache_hit_ratio` on `/api/status`. The
implicit cache is invisible from the outside, and during design one
plausible-looking request layout produced a 0 % hit rate with no error to signal
it.

## API

| Route                  | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `GET /api/health`      | Liveness, model chain, key count, corpus identity   |
| `GET /api/status`      | Health plus counters and per-key health             |
| `GET /api/suggestions` | Opening prompts for an empty transcript             |
| `POST /api/chat`       | A question → an answer (SSE by default)             |
| `POST /api/embed`      | Texts → embedding vectors, for the site's diff tool |

Mounted at `/chat` by Caddy, so from a browser these are
`https://<host>/chat/api/...`.

```bash
curl -N -X POST https://129-146-25-154.sslip.io/chat/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What is Particle Wave?"}'
```

Streaming events are JSON objects with a `type`: `meta`, `delta`, `done`,
`error`. Pass `"stream": false` for a single JSON body.

### `/api/embed`

Backs the semantic comparison in the site's text-diff tool. It lives here
rather than in its own service because it needs exactly what this service
already has and nothing it does not: Gemini credentials, even rotation across
them, per-(key, model) cooldowns, and a rate limiter. A second service would
mean a second copy of all four.

```bash
curl -s -X POST https://129-146-25-154.sslip.io/chat/api/embed \
  -H 'Content-Type: application/json' \
  -d '{"texts":["the cat sat on the mat","a feline rested upon the rug"]}' \
  | python -c 'import json,sys; d=json.load(sys.stdin); print(d["model"], d["dimensions"], len(d["embeddings"]))'
```

The request names no model and no task type. Both are the server's business,
for the same reason a chat request cannot name a model: a client that could
choose would be choosing how to spend a shared free-tier quota. The task type is
fixed at `SEMANTIC_SIMILARITY`, which is the only one this endpoint exists to
serve — `RETRIEVAL_QUERY` and `RETRIEVAL_DOCUMENT` are an asymmetric pair meant
for search and are actively wrong for comparing two documents to each other.

**Vectors come back unit length, always.** This is the one non-obvious thing in
`service/embed.py`. `gemini-embedding-001` returns normalised vectors _only at
its native 3072 dimensions_; ask for 768 and you get a truncated slice that is
no longer unit length. Cosine still works because it divides out the magnitude,
a dot product does not, and the two silently disagree by up to 20% at the low
dimensions. So the service normalises once at the boundary and reports
`normalised: true`, and every consumer gets the property it already assumed.

Its own rate-limit bucket, more generous than chat's. An embed call is a
fraction of the cost of an answer and the tool naturally fires several as
someone edits, so sharing the chat limiter would make the assistant unusable for
anyone who had just used the diff tool.

**A note on what these vectors cannot do.** Measured against this model:
"the cat sat on the mat" scores 0.896 against "a feline was resting upon the
rug", and 0.920 against "the cat did _not_ sit on the mat". The inverted claim
scores higher than the paraphrase. Embedding similarity means "same subject
matter", never "same assertion", and the tool page says so.

## Configuration

Everything is an environment variable; deployed values live in
`infra/compose.yml`. The keys are the exception — they are written to
`infra/chat.env` on the host by `infra/configure.py`, mode 0600, and are never
in the repo.

| Variable                        | Default                   | Notes                                                          |
| ------------------------------- | ------------------------- | -------------------------------------------------------------- |
| `CHAT_GEMINI_API_KEYS`          | —                         | CSV, JSON array, or bracketed-unquoted                         |
| `CHAT_MODELS`                   | see above                 | Primary chain, best first                                      |
| `CHAT_FALLBACK_MODELS`          | `gemini-3.5-flash-lite,…` | Tried after the chain                                          |
| `CHAT_REQUEST_TIMEOUT_S`        | `40`                      | Socket timeout, per read — see below                           |
| `CHAT_MAX_OUTPUT_TOKENS`        | `4096`                    | Bounds thinking **plus** answer, not the answer                |
| `CHAT_THINKING_BUDGET`          | `512`                     | Grounded answers measurably improve                            |
| `CHAT_CORPUS_URL`               | published `corpus.json`   |                                                                |
| `CHAT_CORPUS_REFRESH_S`         | `900`                     |                                                                |
| `CHAT_RATE_LIMIT_PER_MIN`       | `10`                      | Per visitor                                                    |
| `CHAT_ANSWER_CACHE_TTL_S`       | `3600`                    | `0` disables                                                   |
| `CHAT_EMBED_ENABLED`            | `1`                       | `0` makes `/api/embed` answer 503 without a redeploy           |
| `CHAT_EMBED_MODEL`              | `gemini-embedding-001`    | Deliberately outside the chat model chain                      |
| `CHAT_EMBED_DIMENSIONS`         | `768`                     | Knee of the curve: near-3072 quality at a quarter of the bytes |
| `CHAT_EMBED_MAX_TEXTS`          | `64`                      | Per request                                                    |
| `CHAT_EMBED_MAX_CHARS`          | `8000`                    | Per text                                                       |
| `CHAT_EMBED_MAX_TOTAL_CHARS`    | `120000`                  | Across the request, so the per-text cap is not a way around it |
| `CHAT_EMBED_RATE_LIMIT_PER_MIN` | `20`                      | Its own bucket                                                 |

With no keys the service still starts, reports `degraded`, and refuses to
answer. That is deliberate: a backend that exits on a missing key takes the
site's chat UI down with no diagnosable signal.

## Running locally

```bash
uv venv .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
CHAT_GEMINI_API_KEYS='[key1, key2]' \
CHAT_CORPUS_URL=http://127.0.0.1:8899/corpus.json \
  .venv/Scripts/python.exe -m uvicorn service.main:app --port 7870
```

Point `CHAT_CORPUS_URL` at any static server over the site's `dist/`.

## Tests

```bash
.venv/Scripts/python.exe -m pytest tests -q
```

61 tests, covering the failures that are otherwise **silent**: a key list parsed
into subtly corrupt keys, a cooldown that never expires, a citation pointing at
a page that does not exist, an answer cache that could serve one visitor's
context to another, and the prompt prefix losing byte-stability and taking the
cost strategy with it.

The provider call itself is not mocked — it is exercised against the real API
during deploy verification, and a mock of a wire format mostly tests the mock.

## Why not Railtracks or LiteLLM

Railtracks remains the intended path for the planned execution-visualizer work.
It is the wrong tool for _this_ layer today:

1. **Per-request key selection.** The rotation picks a key per attempt; a
   wrapper that binds its credential at construction turns that into building
   and discarding an LLM object per attempt.
2. **Cache accounting.** The whole cost strategy rests on
   `usageMetadata.cachedContentTokenCount` — exactly the provider-specific field
   a normalising abstraction drops.
3. **Failure classification.** Falling back correctly needs 429-with-delay, 503,
   and 400-invalid-key kept distinct. Wrappers collapse these into one exception
   type.

The seam is narrow on purpose: `generate()` and `stream()` are the whole
provider surface, so swapping in a Railtracks-backed implementation later means
matching two functions.
