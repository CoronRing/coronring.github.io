"""
Rebuild the particle-wave wheel from the ParticleWave checkout and vendor it.

This is the manual hand-off that stands in for PyPI. Run it whenever
ParticleWave changes:

    python scripts/sync_wheel.py

It builds a wheel from the ParticleWave repository, drops it in `vendor/`,
removes any older wheel, and rewrites the pinned filename in `requirements.txt`
so the two can never disagree. Publishing to PyPI later makes this script
redundant: replace the vendored line with a version specifier and delete
`vendor/`.

ParticleWave lives in a different checkout from this one, so there is no
reliable relative path to it: pass `--source`, or set `$PARTICLE_WAVE_DIR` in
the .env at the repository root.

The project was called SenseRing until 2026-08, and its distribution
`particle-wave-tool`. Both old spellings are still accepted here — an old .env
or an old wheel in `vendor/` should not turn into a confusing build failure.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VENDOR = ROOT / "vendor"
REQUIREMENTS = ROOT / "requirements.txt"

# `particle_wave-*` is what the current distribution builds; `particle_wave_tool-*`
# is what it built before the rename, matched so an older vendored wheel is
# still found and cleaned up rather than left sitting beside the new one.
WHEEL_GLOB = "particle_wave-*.whl"
LEGACY_WHEEL_GLOB = "particle_wave_tool-*.whl"

# The Dockerfile copies vendor/ into the build context before running pip, so
# a relative path resolves. The alternative also matched here is an https://
# URL, left in the pattern only so an older checkout still gets rewritten
# rather than silently keeping a dead link.
WHEEL_PATH = "./vendor/{name}"
REQ_PATTERN = re.compile(
    r"^(?:\./vendor/|https://\S+/)particle_wave(?:_tool)?-\S*\.whl$",
    re.MULTILINE,
)


# Both spellings of the "where is the engine checkout" setting, newest first.
SOURCE_ENV_KEYS = ("PARTICLE_WAVE_DIR", "SENSERING_DIR")


def _source_from_env_file() -> str | None:
    """Read the checkout path out of the repository .env, if there is one."""
    env_file = ROOT.parent / ".env"
    if not env_file.is_file():
        return None
    values = {}
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key.strip()] = value.strip().strip("'\"")
    for key in SOURCE_ENV_KEYS:
        if values.get(key):
            return values[key]
    return None


def find_source(explicit: str | None) -> Path:
    """Locate the ParticleWave checkout, or explain how to point at it."""
    import os

    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    for key in SOURCE_ENV_KEYS:
        if os.environ.get(key):
            candidates.append(Path(os.environ[key]))
    from_file = _source_from_env_file()
    if from_file:
        candidates.append(Path(from_file))
    # Last-ditch guesses: the checkout beside this repo, or beside its parent,
    # under either the current name or the one it had before the rename.
    for name in ("ParticleWave", "SenseRing"):
        candidates.append(ROOT.parent.parent / name)
        candidates.append(ROOT.parent / name)

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if (resolved / "pyproject.toml").is_file():
            return resolved

    tried = "\n  ".join(str(c) for c in candidates)
    raise SystemExit(
        "Could not find a ParticleWave checkout with a pyproject.toml.\n"
        f"Tried:\n  {tried}\n"
        "Pass --source <path> or set PARTICLE_WAVE_DIR."
    )


def build_wheel(source: Path) -> Path:
    """Build a wheel with uv, falling back to `python -m build`."""
    dist = source / "dist"
    # Keyed on mtime, not just on path: a rebuild of the same version writes the
    # same filename, and comparing paths alone reported "no newer wheel" for a
    # build that had in fact just replaced its contents.
    before = (
        {(p, p.stat().st_mtime_ns) for p in dist.glob(WHEEL_GLOB)} if dist.is_dir() else set()
    )

    if shutil.which("uv"):
        cmd = ["uv", "build", "--wheel"]
    else:
        cmd = [sys.executable, "-m", "build", "--wheel"]

    print(f"building: {' '.join(cmd)}  (cwd={source})")
    # No shell, and argv is a fixed literal list — only `cwd` comes from the
    # operator, who is already running this script locally.
    result = subprocess.run(  # noqa: S603
        cmd, cwd=source, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit(f"wheel build failed with exit code {result.returncode}")

    wheels = sorted(dist.glob(WHEEL_GLOB), key=lambda p: p.stat().st_mtime)
    if not wheels:
        raise SystemExit(
            f"build reported success but no {WHEEL_GLOB} appeared in {dist}. "
            "If the distribution has been renamed again, WHEEL_GLOB and "
            "REQ_PATTERN here need to follow it."
        )

    newest = wheels[-1]
    if (newest, newest.stat().st_mtime_ns) in before:
        print("note: build produced no newer wheel; vendoring the existing one")
    return newest


def vendor(wheel: Path) -> Path:
    """Copy the wheel into vendor/, clearing out any previous build."""
    VENDOR.mkdir(exist_ok=True)
    for glob in (WHEEL_GLOB, LEGACY_WHEEL_GLOB):
        for stale in VENDOR.glob(glob):
            if stale.name != wheel.name:
                print(f"removing stale wheel: {stale.name}")
                stale.unlink()

    target = VENDOR / wheel.name
    shutil.copy2(wheel, target)
    print(f"vendored: {target.relative_to(ROOT)}  ({target.stat().st_size / 1024:.1f} kB)")
    return target


def pin_requirement(wheel_name: str) -> None:
    """Point requirements.txt at the wheel that is actually present."""
    text = REQUIREMENTS.read_text(encoding="utf-8")
    replacement = WHEEL_PATH.format(name=wheel_name)

    if not REQ_PATTERN.search(text):
        raise SystemExit(
            f"No vendored wheel line found in {REQUIREMENTS.name}; "
            "expected a line ending in particle_wave_tool-*.whl"
        )

    updated = REQ_PATTERN.sub(replacement, text)
    if updated != text:
        REQUIREMENTS.write_text(updated, encoding="utf-8")
        print(f"requirements.txt now pins {replacement}")
    else:
        print(f"requirements.txt already pins {replacement}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        "--sensering",
        dest="source",
        help="Path to the ParticleWave checkout. --sensering is the former name.",
    )
    args = parser.parse_args()

    source = find_source(args.source)
    print(f"ParticleWave: {source}")

    wheel = build_wheel(source)
    vendored = vendor(wheel)
    pin_requirement(vendored.name)
    print("done.")


if __name__ == "__main__":
    main()
