"""
Package the backend services as upload-ready Docker build contexts.

    python infra/package_zip.py                  # every artefact
    python infra/package_zip.py --only app       # just the particle-wave zip
    python infra/package_zip.py --tag v3         # dist-docker/particle-wave-backend-v3.zip
    python infra/package_zip.py --out C:/tmp     # somewhere else

The Oracle deploy in `configure.py` ships the same source over SSH and builds
it on the host. This produces the other shape a platform can ask for: a zip
whose root *is* the Docker build context, so a provider that accepts "upload a
zip with a Dockerfile in it" gets exactly that with nothing to rearrange.

Three artefacts, because providers disagree about what a zip should hold:

  particle-wave-backend.zip   one service, Dockerfile at the zip root
  site-chat.zip               one service, Dockerfile at the zip root
  coronring-be-stack.zip      both services plus a compose file, no Caddy

The per-service zips are the ones to reach for first. The stack zip is for a
provider that takes a compose file, and it omits Caddy on purpose: a managed
platform terminates TLS itself, so shipping our own certificate manager would
put two of them in the path and neither would be able to bind :443.

Rebuilds are byte-identical — entries are sorted and timestamps fixed — so an
unchanged tree produces an unchanged zip and re-uploading is a no-op.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Final, NamedTuple

# Same directory, so this resolves when run as a script from anywhere. Reusing
# `configure.EXCLUDE` rather than restating it means a path that is unfit to
# reach the Oracle host is unfit to reach a zip too, by construction.
from configure import EXCLUDE

HERE: Final[Path] = Path(__file__).resolve().parent
ROOT: Final[Path] = HERE.parent
DEFAULT_OUT: Final[Path] = ROOT / "dist-docker"

# Fixed so a rebuild of an unchanged tree is byte-identical. 1980-01-01 is the
# earliest a zip can represent; the field has no informational value here and a
# real mtime would make every rebuild look like a change.
FIXED_TIME: Final[tuple[int, int, int, int, int, int]] = (1980, 1, 1, 0, 0, 0)

LF: Final[str] = chr(10)
"""Newline, as a constant so generated text needs no inline escapes."""



class Service(NamedTuple):
    """One deployable container: where its context lives and how to run it."""

    key: str
    """Directory name inside the stack zip, and the compose service name."""

    source: Path
    """Local build context to package."""

    zip_stem: str
    """Base filename of the single-service zip."""

    port: int
    """Port the image listens on when ``$PORT`` is unset."""

    health: str
    """HTTP path that answers 200 when the service is up."""

    env: dict[str, str]
    """Non-secret configuration, mirroring what ``compose.yml`` sets today."""

    secrets: tuple[str, ...]
    """Variables the operator must set by hand. Never written to any file."""

    summary: str
    """One line for the generated DEPLOY.md."""


# Values mirror infra/compose.yml so a zip deploy behaves like the live host.
# Divergences are commented where they exist.
SERVICES: Final[tuple[Service, ...]] = (
    Service(
        key="app",
        source=ROOT / "backend",
        zip_stem="particle-wave-backend",
        port=7860,
        health="/api/health",
        env={
            "PW_MAX_CONCURRENCY": "3",
            "PW_ALLOWED_ORIGINS": (
                "https://coronring.github.io,http://localhost:4321,http://127.0.0.1:4321"
            ),
            "PW_TRUST_FORWARDED_FOR": "1",
            "PW_LOG_LEVEL": "info",
        },
        secrets=(),
        summary="FastAPI service that turns an uploaded image into a .pwcloud point cloud.",
    ),
    Service(
        key="chat",
        source=ROOT / "chat",
        zip_stem="site-chat",
        port=7870,
        health="/api/health",
        env={
            "CHAT_CORPUS_URL": "https://coronring.github.io/corpus.json",
            "CHAT_CORPUS_REFRESH_S": "900",
            "CHAT_ALLOWED_ORIGINS": (
                "https://coronring.github.io,http://localhost:4321,http://127.0.0.1:4321"
            ),
            "CHAT_TRUST_FORWARDED_FOR": "1",
            "CHAT_LOG_LEVEL": "info",
        },
        secrets=("CHAT_GEMINI_API_KEYS",),
        summary="Site assistant. Streams answers over SSE from a corpus fetched off the site.",
    ),
)

STACK_STEM: Final[str] = "coronring-be-stack"


# ──────────────────────────────────────────────────────────────────────────
# Zip assembly
# ──────────────────────────────────────────────────────────────────────────


def walk(source: Path) -> Iterator[Path]:
    """
    Yield every packageable file under ``source``, sorted for reproducibility.

    Pruning happens at the directory level as well as the file level, so an
    excluded directory is never descended into — the difference between
    skipping ``.venv`` and walking ten thousand files to skip each one.
    """
    for path in sorted(source.rglob("*")):
        if set(path.relative_to(source).parts) & EXCLUDE:
            continue
        if path.suffix == ".pyc" or not path.is_file():
            continue
        yield path


def add_file(archive: zipfile.ZipFile, arcname: str, path: Path) -> None:
    """Add ``path`` at ``arcname`` with a fixed timestamp."""
    info = zipfile.ZipInfo(arcname, date_time=FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    # 0o644, tagged as a regular file. Zips written on Windows carry no mode at
    # all, and a Linux builder then has to guess — which it does correctly for
    # data files and not always for anything else.
    info.external_attr = (0o100644) << 16
    archive.writestr(info, path.read_bytes())


def add_text(archive: zipfile.ZipFile, arcname: str, text: str) -> None:
    """Add generated content at ``arcname`` with a fixed timestamp."""
    info = zipfile.ZipInfo(arcname, date_time=FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (0o100644) << 16
    archive.writestr(info, text.encode("utf-8"))


def add_tree(archive: zipfile.ZipFile, source: Path, prefix: str = "") -> int:
    """Add every packageable file under ``source``. Returns the file count."""
    count = 0
    for path in walk(source):
        rel = path.relative_to(source).as_posix()
        add_file(archive, f"{prefix}{rel}" if prefix else rel, path)
        count += 1
    return count


# ──────────────────────────────────────────────────────────────────────────
# Generated docs
# ──────────────────────────────────────────────────────────────────────────


def env_block(service: Service) -> str:
    lines = [f"{key}={value}" for key, value in service.env.items()]
    lines += [f"{key}=" for key in service.secrets]
    return "\n".join(lines)


def service_readme(service: Service) -> str:
    """The sheet an operator needs to fill in a provider's deploy form."""
    secrets = (
        "\n".join(
            f"- `{key}` — **required**, set it as a secret in the provider UI, "
            "not in a file in this zip."
            for key in service.secrets
        )
        or "- None. The service takes no secrets."
    )
    prefix = "PW" if service.key == "app" else "CHAT"

    # Only the particle-wave service has a concurrency knob, and it is the one
    # setting sized to the Oracle host's hardware rather than to the site.
    concurrency = (
        f"""
- **`{prefix}_MAX_CONCURRENCY`** is `{service.env[f"{prefix}_MAX_CONCURRENCY"]}`,
  sized for the Oracle box's four ARM cores. Bring it down to match a smaller
  plan: conversions are CPU-bound and the limit is per process."""
        if f"{prefix}_MAX_CONCURRENCY" in service.env
        else ""
    )
    return f"""\
# {service.zip_stem} — container deploy

{service.summary}

The root of this zip **is** the Docker build context. `Dockerfile` sits beside
this file, so a provider that asks for "a zip with a Dockerfile" needs no build
path, no subdirectory, and no other configuration to find it.

## What the platform needs to know

| Setting | Value |
| --- | --- |
| Build context | the zip root (`.`) |
| Dockerfile | `./Dockerfile` |
| Listen port | `{service.port}`, or whatever `$PORT` is set to |
| Health check | `GET {service.health}` |
| Runs as | non-root, uid 1000 |
| Volumes | none — the container holds no state |

`$PORT` is honoured, so a platform that injects one needs nothing changed. If
yours wants a fixed port instead, use `{service.port}`.

Nothing in the image is host-specific. It carries no certificate, binds no
privileged port, and writes nothing outside its own filesystem — the platform's
router is expected to terminate TLS in front of it.

## Environment

Copy these into the provider's environment settings.

```env
{env_block(service)}
```

{secrets}

These values match what the live Oracle host runs today, so a zip deploy
behaves the same. Some are worth reading rather than pasting:

- **`{prefix}_TRUST_FORWARDED_FOR`** is `1` because a managed platform puts a
  proxy in front and the per-client rate limiter reads `X-Forwarded-For` to tell
  visitors apart. That holds only while the proxy *sets* the header. If this
  provider passes the client's own headers straight through, set it to `0` —
  otherwise a caller can forge the header and the rate limit becomes advisory.
- **`{prefix}_ALLOWED_ORIGINS`** is the CORS allowlist for *callers*, not a list
  of where this service may run, so it does not change when the host does. It
  needs an entry per site origin that will call this deployment.{concurrency}

Every other variable and its default is in `README.md`.

## Pointing the site at it

The Astro site reads the backend URLs at build time:

```
PUBLIC_PARTICLE_WAVE_API=https://<new-host>
PUBLIC_SITE_CHAT_API=https://<new-host>
```

Set the one this service answers and rebuild the site. Unset, both fall back to
the Oracle host, so a half-finished migration keeps working rather than
half-breaking.

Note the chat URL has no `/chat` suffix here. On Oracle both services share one
hostname and Caddy strips that prefix; on a platform that gives each service its
own hostname, the service is at the root and the suffix would be wrong.

## Verifying

```bash
docker build -t {service.zip_stem} .
docker run --rm -p {service.port}:{service.port} {service.zip_stem}
curl -fsS http://localhost:{service.port}{service.health}
```

Regenerate this zip with `python infra/package_zip.py`.
"""


def secrets_template(service: Service) -> str:
    """A fill-in-the-blanks env file for one service's secrets."""
    lines = [
        f"# Secrets for the `{service.key}` service. Copy to `{service.key}.env`",
        "# and fill in the values, then `docker compose up -d --build`.",
        "#",
        "# Never commit the filled-in copy. The stack starts without it and the",
        "# service reports `degraded` on /api/health, so an empty deploy fails",
        "# loudly in the right place rather than at container start.",
        "",
    ]
    lines += [f"{key}=" for key in service.secrets]
    lines.append("")
    return LF.join(lines)


def stack_compose() -> str:
    """A compose file for a platform that takes one, with Caddy left out."""
    body = [
        "# Both services, for a platform that accepts a compose file.",
        "#",
        "# Derived from infra/compose.yml with two deliberate differences:",
        "#",
        "#   - No Caddy. A managed platform terminates TLS and routes for you.",
        "#     Ours would be a second certificate manager in the path, and it",
        "#     could not bind :443 anyway.",
        "#   - Ports are published rather than `expose`d, because there is no",
        "#     longer a reverse proxy inside the compose network to reach them.",
        "#",
        "# Regenerate with `python infra/package_zip.py`.",
        "",
        "x-logging: &logging",
        "  driver: json-file",
        "  options:",
        '    max-size: "10m"',
        '    max-file: "3"',
        "",
        "services:",
    ]
    for service in SERVICES:
        body += [
            f"  {service.key}:",
            "    logging: *logging",
            "    build:",
            f"      context: ./{service.key}",
            "      dockerfile: Dockerfile",
            "    restart: unless-stopped",
            "    environment:",
        ]
        body += [f'      {key}: "{value}"' for key, value in service.env.items()]
        body.append(f'      PORT: "{service.port}"')
        if service.secrets:
            body += [
                "    # Secrets stay out of the repo and out of this file. Copy",
                f"    # {service.key}.env.example to {service.key}.env and fill it in, or",
                "    # replace this block with the platform's own secret injection.",
                "    #",
                "    # `required: false` so a keyless stack still comes up. The service",
                "    # then reports `degraded` and refuses to answer, which is far easier",
                "    # to diagnose than compose refusing to parse its own file — which is",
                "    # what a bare `- ./chat.env` does when the file is absent.",
                "    env_file:",
                f"      - path: ./{service.key}.env",
                "        required: false",
            ]
        body += [
            "    ports:",
            f'      - "{service.port}:{service.port}"',
            "    healthcheck:",
            '      test: ["CMD", "python", "-c",',
            f"             \"import urllib.request;urllib.request.urlopen('http://127.0.0.1:"
            f"{service.port}{service.health}')\"]",
            "      interval: 30s",
            "      timeout: 5s",
            "      retries: 3",
            "      start_period: 20s",
            "",
        ]
    return "\n".join(body)


def stack_readme() -> str:
    rows = "\n".join(
        f"| `{s.key}/` | {s.zip_stem} | `{s.port}` | `{s.health}` |" for s in SERVICES
    )
    secrets = "\n".join(
        f"- `{s.key}.env` — `{key}=<value>`" for s in SERVICES for key in s.secrets
    )
    return f"""\
# coronring backend stack — container deploy

Both backend services in one zip, for a provider that accepts a compose file.
If yours wants a single Dockerfile instead, use `particle-wave-backend.zip` or
`site-chat.zip` — each of those has its Dockerfile at the zip root.

| Directory | Service | Port | Health |
| --- | --- | --- | --- |
{rows}

## Caddy is not here, on purpose

The Oracle deploy runs Caddy in front of both services to obtain a Let's
Encrypt certificate for a `sslip.io` hostname, because the site is served over
HTTPS from github.io and a page loaded over HTTPS cannot call an `http://`
backend. A managed platform already does that part, so including ours would put
two certificate managers in the path and the second one could not bind `:443`.

One consequence: Caddy is also what mounts the chat service under `/chat` and
strips the prefix. Without it the chat service answers at its own root, so
`PUBLIC_SITE_CHAT_API` loses the `/chat` suffix.

## Secrets

Copy the template next to `compose.yml` and fill it in, or wire the platform's
own secret injection in place of the `env_file` block:

```bash
cp chat.env.example chat.env   # then edit
```

{secrets}

The `env_file` entry is marked `required: false`, so the stack comes up without
it. The chat service then reports `degraded` on `/api/health` and refuses to
answer, which is far easier to diagnose than compose refusing to parse its own
file. Particle-wave needs no secret at all: `PW_API_KEY` is deliberately unset
so the bundled demo page works.

## Locally

```bash
docker compose up -d --build
curl -fsS http://localhost:7860/api/health
curl -fsS http://localhost:7870/api/health
```

Per-service configuration is in each directory's `README.md` and `DEPLOY.md`.
Regenerate this zip with `python infra/package_zip.py`.
"""


# ──────────────────────────────────────────────────────────────────────────
# Build
# ──────────────────────────────────────────────────────────────────────────


def suffixed(stem: str, tag: str | None) -> str:
    return f"{stem}-{tag}.zip" if tag else f"{stem}.zip"


def build_service(service: Service, out: Path, tag: str | None) -> Path:
    target = out / suffixed(service.zip_stem, tag)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        count = add_tree(archive, service.source)
        add_text(archive, "DEPLOY.md", service_readme(service))
        count += 1
    print(f"  {target.name}  ({count} files, {target.stat().st_size / 1024:.0f} kB)")
    return target


def build_stack(out: Path, tag: str | None) -> Path:
    target = out / suffixed(STACK_STEM, tag)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        count = 0
        for service in SERVICES:
            count += add_tree(archive, service.source, prefix=f"{service.key}/")
            add_text(archive, f"{service.key}/DEPLOY.md", service_readme(service))
            count += 1
            if service.secrets:
                add_text(archive, f"{service.key}.env.example", secrets_template(service))
                count += 1
        add_text(archive, "compose.yml", stack_compose())
        add_text(archive, "README.md", stack_readme())
        count += 2
    print(f"  {target.name}  ({count} files, {target.stat().st_size / 1024:.0f} kB)")
    return target


def git_tag() -> str | None:
    """Short commit of the working tree, for `--tag git`. None if unavailable."""
    try:
        result = subprocess.run(  # noqa: S603
            ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],  # noqa: S607
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None if result.returncode == 0 else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        choices=[*(s.key for s in SERVICES), "stack"],
        action="append",
        help="Build one artefact. Repeatable. Default is all three.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output directory (default: {DEFAULT_OUT.relative_to(ROOT)}/).",
    )
    parser.add_argument(
        "--tag",
        help="Filename suffix. `git` uses the short commit.",
    )
    args = parser.parse_args()

    tag: str | None = args.tag
    if tag == "git":
        tag = git_tag()
        if tag is None:
            print("  no git revision available — building untagged")

    wanted: set[str] = set(args.only or [*(s.key for s in SERVICES), "stack"])

    for service in SERVICES:
        if service.key in wanted and not service.source.is_dir():
            raise SystemExit(f"missing build context: {service.source}")

    out: Path = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    print(f"packaging into {out}")

    built: list[Path] = []
    for service in SERVICES:
        if service.key in wanted:
            built.append(build_service(service, out, tag))
    if "stack" in wanted:
        built.append(build_stack(out, tag))

    print(f"\n{len(built)} artefact(s) in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
