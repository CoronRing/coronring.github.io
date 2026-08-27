---
name: coronring-site
description: Working on coronring.github.io, the personal site, its FastAPI particle-wave backend, or the Oracle infra that hosts it. Use when editing the Astro site, the Python service under backend/, the deploy tooling under infra/, the vendored particle engine, or any copy that a visitor reads. Covers environments, the two deploy paths, verification recipes, commit discipline, and the house writing style.
---

# coronring.github.io

A personal site that employers and clients read, plus a Python service behind
one of its demos. Two audiences: the visitor, who sees prose and a canvas, and
the operator, who runs deploys by hand.

Read [`docs/SYSTEM.md`](../../../docs/SYSTEM.md) before changing anything that
crosses a component boundary. It has the architecture, the contracts, and the
accumulated traps. This file is about how to work here.

## Before anything else

The repository path contains a space. Quote it.

```
c:\Users\guanz\Desktop\project-py-NLP toolbox\nlp_application_toolbox\coronring.github.io
```

Three separate environments, and using the wrong one is the most common way to
waste a turn:

| Task                                     | Interpreter or runner                 |
| ---------------------------------------- | ------------------------------------- |
| Astro site, cloud generator              | `npm` / `node` from the repo root     |
| Backend service and its tests            | `backend/.venv/Scripts/python.exe`    |
| Infra scripts (`provision`, `configure`) | the toolbox `.venv`, with the OCI SDK |

Check before running anything Python: `(Get-Command python).Source` must
resolve inside the project, not to Anaconda. Never call bare `python` for
backend work.

```bash
# backend, from coronring.github.io/
uv venv -p 3.11 backend/.venv
uv pip install --python backend/.venv/Scripts/python.exe -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m pytest -q backend      # 45 tests
```

The root `.venv` of the outer toolbox is shared by every project in it. Do not
install project-specific packages there.

## Command index

```bash
npm run dev                        # localhost:4321
npm run build                      # astro check && astro build; a type error fails it
npm run format                     # prettier
node scripts/generate-cloud.mjs    # regenerate public/clouds/corona.pwcloud

backend/.venv/Scripts/python.exe -m pytest -q backend
backend/.venv/Scripts/python.exe -m uvicorn service.main:app --reload --port 7860

python backend/scripts/sync_wheel.py   # SenseRing -> wheel -> vendor -> requirements.txt
python infra/configure.py --deploy     # rebuild and restart on the host
python infra/configure.py --logs       # tail the running stack
python infra/provision.py --show       # what exists right now
```

Always run `npm run build`, not `build:fast`, before claiming a change is good.
The type check is the only thing standing between a bad edit and a failed
deploy.

## The two deploys

The site deploys from CI on push to `main`. The service does not deploy from CI
at all, and is only live after someone runs `infra/configure.py --deploy`.

Never assume they match. The failure that actually shipped was a site and a
service that both worked in isolation and had never been connected. Verify
against the public URL, not a local preview:

1. Load `https://coronring.github.io/projects/particle-wave/`.
2. Scroll the demo into view. The island is `client:visible` and will not
   hydrate above the fold, which has caused false test failures.
3. Upload an image and read the provenance label. A label reading "traced by
   the Python service" means the whole chain works. "traced in this tab" means
   the request failed and the fallback caught it.

Check the browser console for CORS and CSP violations while doing it. Those two
are configured on opposite sides of the boundary and are easy to half-fix.

## Committing

Stage by name, one file at a time, and read the list back before committing.
Never `git add .` and never `commit .`.

The working tree has held `.env`, `*.pem`, `infra/state.json`,
`infra/known_hosts`, and two `.venv` directories. `.gitignore` covers all of
them, but confirm with `git diff --cached --name-only` anyway.

Do not push without being asked. Do not commit draft notes, scratch analysis,
or anything under `.agent_temp/`.

Temporary scripts go in `.agent_temp/`. Logs go in `.log/`. Neither belongs in
a commit.

## House style for anything a visitor reads

This site is a hiring surface. Copy that reads as machine-generated costs more
than copy that is merely plain. The rules below apply to `src/content/`,
`src/data/`, page `lede` and `description` props, demo captions, button labels,
and `README.md`.

**No em dashes.** Not one. Restructure the sentence: use a full stop, a colon,
a comma, or parentheses. Use an en dash only for a numeric or date range
(`2026 – present`). Use `·` for the separators the design already uses
(page titles, metadata strips, tech lists).

Avoid the constructions that give machine writing away:

- "not just X, but Y" and "X is not merely Y, it's Z"
- an em-dashed appositive carrying a three-item list
- "the point is", "worth noting", "it's important to note"
- "delve", "leverage", "robust", "seamless", "unlock", "elevate", "testament to"
- opening a paragraph by restating the heading
- a triad where two items would do

What to do instead: lead with the concrete claim, keep the number, cut the
framing. "Achieved 90% preference over GitHub Copilot" becomes "was preferred to
GitHub Copilot 90% of the time". Specific verbs and real figures read as human
because a machine hedges and a person commits.

Keep the existing voice where it is already direct. Lines like "Claims about a
physics engine are cheap; letting the reader move the spring constant is not"
are doing work. Do not flatten them into neutral prose while removing dashes.

Grep before finishing:

```bash
grep -rn "—" src/content src/data src/pages src/components README.md
npm run build && grep -rn "—" dist --include="*.html"
```

Code comments and the design documents under `docs/` are not visitor-facing and
are held to a lower bar, but new prose should follow the same rules.

## Content model

Content is Zod-validated in `src/content.config.ts`, so a bad frontmatter field
fails the build rather than rendering wrong.

- **Project**: MDX in `src/content/projects/`. Set `interactive: true` and
  `demo: "<key>"` to mount an island; the key must exist in
  `src/components/demos/registry.ts`.
- **Resume entry**: Markdown in `src/content/experience/`, `kind` one of
  `work`, `education`, `leadership`, `award`, `certification`. Omit `end` for a
  current role.
- **Resource**: Markdown in `src/content/resources/` with a `category` that
  matches the map in `src/pages/resources.astro`.
- **Tool**: one entry in `src/data/tools.ts`, an island in
  `src/components/tools/`, a route using `ToolLayout`.

`DemoFrame.astro` branches on the demo key explicitly rather than looking it up
in a map, because Astro needs the island imports to be statically analysable.
Adding a demo means adding a branch there too.

## Design documents

Work that goes beyond what a design document describes updates that document in
the same change, and bumps its version once.

| Change                                      | Document                 |
| ------------------------------------------- | ------------------------ |
| Site structure, visuals, engine integration | `docs/.temp/DESIGN.md`   |
| Service API, limits, security, performance  | `backend/docs/design.md` |
| Host resources, deploy procedure            | `infra/README.md`        |
| Anything crossing a component boundary      | `docs/SYSTEM.md`         |

If the code and a document disagree, the document is wrong.

## Standing hazards

**`SenseRing/` is in no git repository.** It is the source of the particle
engine, it lives beside this repo in the outer toolbox, and `git ls-files`
returns nothing for it. Only the built wheel in `backend/vendor/` is versioned.
Say so before starting work that modifies it.

**Sampler changes must be proved output-identical.** Under a fixed `rng_seed`,
compare SHA-256 over the packed arrays across a spread of images and
configurations. A nine-case baseline missed a real regression that a twenty-case
harness caught.

**Do not claim privacy the code does not provide.** The demo caption says
nothing is stored. That is true only because the service decodes uploads in
memory and never writes to disk. Re-verify before repeating the claim, and
change the caption if the behaviour changes.

**Free-tier host.** The service runs on Oracle always-free hardware and can be
unreachable. Any site feature that calls it needs a fallback path, and the
fallback needs to be visibly labelled rather than silently substituted.
