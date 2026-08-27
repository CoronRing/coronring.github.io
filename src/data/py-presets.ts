/**
 * Environments the in-browser Python runner can offer.
 *
 * ## Why a registry rather than one hardcoded environment
 *
 * Most of the work on this site is a Python package with no interface. The
 * fastest way to show what one does is to let someone run it, and the only place
 * a visitor will run anything is in the tab they already have open. So the runner
 * is built to be mounted more than once: a project page passes the single preset
 * for its own package and gets a runnable demo, and the tools page passes all of
 * them and gets a scratchpad.
 *
 * Adding a package means adding an entry here. Nothing else.
 *
 * ## What the browser can and cannot install
 *
 * Pyodide runs CPython compiled to WebAssembly. Pure-Python wheels install from
 * PyPI unchanged. Anything with a compiled extension needs a wheel built *for
 * WebAssembly*, and that only exists if Pyodide prebuilt it or the maintainer
 * publishes one. Nothing can be compiled in the tab.
 *
 * That is a hard boundary, and it is the reason `blockers` exists on a preset:
 * an environment that is known not to install says so before it spends
 * forty seconds proving it, and links the way to run the same code locally.
 */

export interface PresetSample {
  readonly id: string;
  readonly label: string;
  /** One line on what the sample demonstrates. */
  readonly note: string;
  readonly code: string;
  /** Initial standard input lines for input() calls. */
  readonly stdin?: string;
}

export interface PresetBlocker {
  /** The distribution that cannot be installed. */
  readonly spec: string;
  /** Why, in one sentence a reader can act on. */
  readonly reason: string;
}

export interface PyPreset {
  readonly id: string;
  readonly name: string;
  /** Shown under the picker. What this environment is for. */
  readonly blurb: string;
  /** Installed on first run. Pyodide's bundled builds are used where they exist. */
  readonly packages: readonly string[];
  /** Direct wheel URLs, for a package the index cannot resolve. */
  readonly wheels?: readonly string[];
  readonly samples: readonly PresetSample[];
  /**
   * Known-unsatisfiable requirements.
   *
   * Present means the install is expected to fail. The runner still attempts it
   * on request, because this is a fact about today's wheel availability rather
   * than about the code, and it changes without warning.
   */
  readonly blockers?: readonly PresetBlocker[];
  /** How to run the same thing locally, when the browser cannot. */
  readonly localCommand?: string;
  /** Approximate first-run download, so a slow connection is not a surprise. */
  readonly weight: string;
}

/* ── Plain ────────────────────────────────────────────────────────────── */

const PLAIN: PyPreset = {
  id: 'plain',
  name: 'Python 3.13',
  blurb:
    'The standard library, and any pure-Python package you name. No network access from inside the interpreter, so a script that calls out will fail.',
  packages: [],
  weight: '~12 MB on first run, then cached',
  samples: [
    {
      id: 'hello',
      label: 'Standard library tour',
      note: 'Shows what is actually available: the full stdlib, at the real version.',
      code: `import sys, platform, json, collections, itertools, hashlib
from datetime import datetime, timezone

print(f"Python {sys.version.split()[0]} on {platform.machine()}")
print(f"UTC now: {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}")

# The stdlib is all here, not a subset.
counts = collections.Counter("the quick brown fox jumps over the lazy dog".split())
print("word counts:", json.dumps(counts.most_common(3)))

pairs = list(itertools.combinations("abcd", 2))
print(f"{len(pairs)} pairs:", pairs)

print("sha256:", hashlib.sha256(b"particle wave").hexdigest()[:32], "...")

# A bare expression at the end is echoed, the way a REPL would.
sum(x * x for x in range(1, 11))
`,
    },
    {
      id: 'input',
      label: 'Reading input',
      note: 'input() reads the stdin box. One line per call, and None at the end.',
      stdin: 'Alice\n3',
      code: `name = input("Name: ")
count = int(input("How many? "))

for i in range(1, count + 1):
    print(f"{i:>3}. hello, {name}")
`,
    },
    {
      id: 'error',
      label: 'A traceback',
      note: 'Failures come back as a real Python traceback, not a one-line summary.',
      code: `def parse_budget(raw: str) -> int:
    """Deliberately fragile, to show what a failure looks like."""
    return int(raw.strip().replace(",", ""))


for value in ["1,000", " 42 ", "twelve"]:
    print(value, "->", parse_budget(value))
`,
    },
    {
      id: 'timeit',
      label: 'Measuring something',
      note: 'WebAssembly is slower than native by roughly 2x to 5x. Worth knowing before benchmarking here.',
      code: `import timeit

setup = "data = list(range(10_000))"

for name, stmt in [
    ("list comprehension", "[x * 2 for x in data]"),
    ("map + list        ", "list(map(lambda x: x * 2, data))"),
    ("explicit loop     ", "out = []\\nfor x in data: out.append(x * 2)"),
]:
    seconds = timeit.timeit(stmt, setup=setup, number=200)
    print(f"{name}  {seconds * 1000 / 200:6.3f} ms per run")
`,
    },
  ],
};

/* ── Scientific ───────────────────────────────────────────────────────── */

const SCIENTIFIC: PyPreset = {
  id: 'scientific',
  name: 'NumPy + SciPy',
  blurb:
    'The numeric stack, in prebuilt WebAssembly form. Real compiled BLAS, so the linear algebra is fast rather than emulated.',
  packages: ['numpy', 'scipy', 'pandas'],
  weight: '~30 MB extra on first run',
  samples: [
    {
      id: 'linalg',
      label: 'Linear algebra',
      note: 'NumPy here is the genuine compiled build on top of OpenBLAS, not a pure-Python stand-in.',
      code: `import numpy as np

rng = np.random.default_rng(seed=7)
A = rng.normal(size=(6, 6))

eigenvalues = np.linalg.eigvals(A)
print("spectral radius:", round(float(np.abs(eigenvalues).max()), 4))

# Solve, then check the residual rather than trusting it.
b = rng.normal(size=6)
x = np.linalg.solve(A, b)
print("residual norm:", float(np.linalg.norm(A @ x - b)))

print("condition number:", round(float(np.linalg.cond(A)), 1))
`,
    },
    {
      id: 'signal',
      label: 'Signal processing',
      note: 'A Butterworth filter over synthetic data. SciPy is fully present, including scipy.signal.',
      code: `import numpy as np
from scipy import signal

fs = 500.0
t = np.arange(0, 2.0, 1 / fs)
clean = np.sin(2 * np.pi * 5 * t)
noisy = clean + 0.6 * np.sin(2 * np.pi * 120 * t)

sos = signal.butter(6, 20, btype="low", fs=fs, output="sos")
filtered = signal.sosfiltfilt(sos, noisy)

def rms(x):
    return float(np.sqrt(np.mean(x ** 2)))

print(f"clean    rms {rms(clean):.4f}")
print(f"noisy    rms {rms(noisy):.4f}")
print(f"filtered rms {rms(filtered):.4f}")
print(f"error vs clean: {rms(filtered - clean):.4f}")
`,
    },
    {
      id: 'pandas',
      label: 'DataFrames',
      note: 'Pandas, with a grouped aggregation over data built in the tab.',
      code: `import numpy as np
import pandas as pd

rng = np.random.default_rng(1)
frame = pd.DataFrame({
    "provider": rng.choice(["anthropic", "openai", "google"], 300),
    "tokens": rng.integers(200, 8000, 300),
    "latency_ms": rng.gamma(shape=3.0, scale=180.0, size=300),
})

summary = frame.groupby("provider").agg(
    calls=("tokens", "size"),
    tokens=("tokens", "sum"),
    p50_ms=("latency_ms", lambda s: s.quantile(0.50)),
    p95_ms=("latency_ms", lambda s: s.quantile(0.95)),
).round(1)

print(summary.to_string())
`,
    },
  ],
};

/* ── Particle Wave ────────────────────────────────────────────────────── */

/**
 * The published `particle-wave` package, running for real.
 *
 * Installed with dependency resolution off and its dependencies named
 * explicitly. That is not a shortcut around a broken package: the wheel declares
 * `typer[all]`, an extra Typer stopped publishing, and micropip treats an
 * unknown extra as a hard error where pip only warns. Naming the dependencies
 * sidesteps a metadata detail that has nothing to do with whether the code runs.
 */
const PARTICLE_WAVE: PyPreset = {
  id: 'particle-wave',
  name: 'particle-wave',
  blurb:
    'The image-to-point-cloud extractor from PyPI, running in the tab. The same package the site’s demo backend imports, at the same version.',
  packages: ['numpy', 'scipy', 'pillow', 'pyyaml', 'typer', 'click', 'rich', 'particle-wave'],
  weight: '~32 MB extra on first run',
  samples: [
    {
      id: 'extract',
      label: 'Extract a point cloud',
      note: 'Builds an image in memory, runs the full four-stage pipeline, and prints what came out.',
      code: `import numpy as np
from PIL import Image
from particle_wave.tool.pipeline import Pipeline, PipelineConfig

# A synthetic target: concentric rings, so there is real edge structure
# to find rather than noise.
size = 320
y, x = np.mgrid[0:size, 0:size]
radius = np.hypot(x - size / 2, y - size / 2)
rings = (np.sin(radius / 6.0) * 0.5 + 0.5) * 255
image = Image.fromarray(rings.astype(np.uint8)).convert("RGB")

cfg = PipelineConfig()
cfg.sampling.target_points = 4000
cfg.preprocess.max_resolution = 320

cloud = Pipeline(cfg).build(image, source_name="rings.png")

for key in sorted(cloud["meta"]):
    print(f"meta.{key}: {cloud['meta'][key]}")

# The document stores points as one flat array with a stride, not as a list of
# objects. That is the whole reason a .pwcloud is small enough to ship: 4,000
# points as JSON objects is roughly six times the bytes.
fields, stride, data = cloud["fields"], cloud["stride"], cloud["data"]
print(f"\\nencoding: {cloud['encoding']}, fields {fields}, stride {stride}")
print(f"{len(data):,} values = {len(data) // stride:,} points")

for i in range(3):
    row = data[i * stride:(i + 1) * stride]
    print("  ", dict(zip(fields, row)))

preview = cloud["preview"]
print(f"\\npreview: {preview['mime']} {preview['width']}x{preview['height']}, "
      f"{len(preview['data']):,} base64 chars")
`,
    },
    {
      id: 'config',
      label: 'Read the option schema',
      note: 'The config dataclasses are the API contract the service builds its controls from.',
      code: `import dataclasses
from particle_wave.tool.pipeline import PipelineConfig

cfg = PipelineConfig()

def show(name, obj, indent=0):
    pad = "  " * indent
    if dataclasses.is_dataclass(obj):
        print(f"{pad}{name}:")
        for field in dataclasses.fields(obj):
            show(field.name, getattr(obj, field.name), indent + 1)
    else:
        print(f"{pad}{name} = {obj!r}")

show("PipelineConfig", cfg)
`,
    },
    {
      id: 'version',
      label: 'What is installed',
      note: 'Confirms the wheel came from PyPI and reports the version, so the demo cannot drift from the release.',
      code: `import importlib.metadata as md
import particle_wave

print("particle_wave.__version__:", particle_wave.__version__)

dist = md.distribution("particle-wave")
print("distribution version:  ", dist.version)
print("declared requirements:")
for requirement in dist.requires or []:
    print("   ", requirement)
`,
    },
  ],
};

/* ── Railtracks ───────────────────────────────────────────────────────── */

/**
 * Railtracks, which does not install in a browser today.
 *
 * Every blocker below was reproduced against Pyodide 0.28.3 rather than
 * inferred, and each is a missing WebAssembly build rather than anything wrong
 * with the framework:
 *
 * - `pydantic>=2.11` is a direct requirement. Pyodide 0.28.3 bundles 2.10.6, and
 *   micropip refuses to install a newer one because `pydantic-core` publishes
 *   WebAssembly wheels only for CPython 3.14, where Pyodide is on 3.13. This one
 *   stops the install before anything else is attempted.
 * - `tokenizers`, via LiteLLM, is a Rust extension with no WebAssembly wheel on
 *   PyPI at any version.
 * - `fastuuid`, also via LiteLLM, likewise.
 *
 * There is a second, independent obstacle past the install. A Railtracks agent
 * calls a model, and no major provider sends CORS headers, so a browser cannot
 * reach one directly whatever is installed. A working browser demo would need a
 * proxy holding a key, which is not something to put on a public site.
 *
 * The preset stays in the registry rather than being deleted. It attempts the
 * install for real, reports what actually stopped it, and hands over the local
 * command. When those wheels appear, this starts working with no code change.
 */
const RAILTRACKS: PyPreset = {
  id: 'railtracks',
  name: 'railtracks',
  blurb:
    'The agent framework. It does not install in a browser yet, and the sample below is the same code that runs locally. Attempt the install to see exactly what stops it.',
  packages: ['pydantic', 'pyyaml', 'rich', 'colorama', 'python-dotenv', 'railtracks'],
  weight: 'attempts ~20 MB, then stops',
  blockers: [
    {
      spec: 'pydantic>=2.11',
      reason:
        'Pyodide 0.28.3 bundles pydantic 2.10.6. Installing a newer one needs pydantic-core, which publishes WebAssembly wheels only for CPython 3.14, and Pyodide is on 3.13.',
    },
    {
      spec: 'tokenizers',
      reason:
        'Required by LiteLLM. A Rust extension with no WebAssembly wheel on PyPI, at any version.',
    },
    {
      spec: 'fastuuid',
      reason: 'Also required by LiteLLM, and also a Rust extension with no WebAssembly build.',
    },
  ],
  localCommand: 'uv pip install railtracks',
  samples: [
    {
      id: 'agent',
      label: 'A single-node agent',
      note: 'The shape of a Railtracks program. Runs locally with a key in the environment.',
      code: `"""Smallest useful Railtracks program: one node, one call.

Runs locally after:

    uv pip install railtracks
    export OPENAI_API_KEY=...

It will not run in this tab. See the note under the editor for why.
"""

import asyncio

import railtracks as rt


@rt.function_node
async def summarise(text: str) -> str:
    """One node. The framework handles retries, tracing and concurrency."""
    reply = await rt.llm.chat(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Summarise in one sentence."},
            {"role": "user", "content": text},
        ],
    )
    return reply.content


async def main() -> None:
    result = await rt.call(
        summarise,
        text="Railtracks is a framework for building resilient agentic systems in plain Python.",
    )
    print(result)


asyncio.run(main())
`,
    },
    {
      id: 'why',
      label: 'Check the blockers yourself',
      note: 'Runs in the tab. Reports which of railtracks’ dependencies have a WebAssembly build and which do not.',
      code: `"""Why railtracks will not install here, checked rather than asserted.

This runs in the plain environment. It reads Pyodide's own package list and
compares it against what railtracks asks for.
"""

import importlib.metadata as md
import sys

print(f"Pyodide interpreter: CPython {sys.version.split()[0]}\\n")

# What railtracks 1.5.0 declares, from its wheel metadata on PyPI.
REQUIRED = [
    ("colorama", ">=0.4.6"),
    ("litellm", ">=1.84.0,<=1.89.0"),
    ("mcp", ">=1.23.0,<2"),
    ("pydantic", ">=2.11,<3"),
    ("python-dotenv", ">=1.0.0"),
    ("PyYAML", ">=6.0"),
    ("rich", ">=13.7.1"),
]

for name, constraint in REQUIRED:
    try:
        version = md.version(name)
        print(f"  present   {name:<16} {version:<10} (wants {constraint})")
    except md.PackageNotFoundError:
        print(f"  MISSING   {name:<16} {'':<10} (wants {constraint})")

print("""
The install stops at pydantic. This interpreter has 2.10.6 and railtracks
needs 2.11 or newer; pydantic-core, which pydantic is built on, publishes
WebAssembly wheels only for CPython 3.14.

Past that, litellm pulls in tokenizers and fastuuid. Both are Rust
extensions with no WebAssembly wheel published at any version, and nothing
can be compiled inside a browser tab.

Neither is a problem with railtracks. Both are missing builds, and both
would resolve themselves the day those wheels appear.
""")
`,
    },
  ],
};

/* ── Registry ─────────────────────────────────────────────────────────── */

export const PY_PRESETS: readonly PyPreset[] = [PLAIN, SCIENTIFIC, PARTICLE_WAVE, RAILTRACKS];

/** Look a preset up by id. */
export function findPreset(id: string): PyPreset | undefined {
  return PY_PRESETS.find((preset) => preset.id === id);
}

/**
 * The subset a project page should mount.
 *
 * A project page wants its own package and a fallback to plain Python, not the
 * whole registry: the point there is the package, and four options is a menu
 * rather than a demo.
 */
export function presetsFor(ids: readonly string[]): readonly PyPreset[] {
  return ids.map(findPreset).filter((preset): preset is PyPreset => preset !== undefined);
}
