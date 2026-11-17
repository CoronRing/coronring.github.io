"""
Keep this host above Oracle's idle threshold, so the free tier does not take it.

Oracle reclaims Always Free compute it considers idle, and publishes the test it
applies. Over any 7-day window an instance is idle when **all** of these hold:

    CPU utilization, 95th percentile  < 20%
    network utilization               < 20%
    memory utilization                < 20%   (A1 shapes only)

They are joined by "and", which is the whole opportunity here: an instance that
clears any single one of the three is not idle, and nothing else about it
matters. So this process raises two of them and leaves the third alone.

**CPU, on every shape.** The bar is the 95th percentile, not the mean, so the
cost of clearing it is far lower than it first looks: the percentile sits above
20% as soon as more than 5% of the samples do. A burst of BUSY_S every PERIOD_S
puts roughly 15% of one-minute samples at full tilt on one core and leaves the
machine genuinely unloaded the rest of the time. The burner runs at nice 19, so
a visitor converting an image preempts it entirely rather than queueing behind
it.

**Memory, on A1 only.** A ballast of anonymous pages, touched often enough to
stay resident. It is sized as a top-up rather than an addition: each cycle it
asks how much memory everything else is using and claims only the difference
between that and the target. So it fills an empty machine and gets out of the
way of a busy one, and oom_score_adj 1000 in compose.yml means the kernel
reaches for this process first if it ever gets the arithmetic wrong.

**Network is deliberately untouched.** 20% of this instance's bandwidth is
hundreds of megabits held for a week. There is no honest way to produce that,
and a dishonest one would be a bandwidth bill wearing a costume.

Everything here is stdlib, because a process whose entire job is to still be
running in six months should not have a dependency that can rot.
"""

from __future__ import annotations

import multiprocessing
import os
import signal
import sys
import time
from pathlib import Path

# ── What to hold, and how hard ────────────────────────────────────────────

#: Fraction of total RAM to keep in use. Oracle's bar is 20%; the gap is there
#: so a sampling interval that lands badly, or a few hundred MB of page cache
#: being reclaimed, does not drop a reading under the line.
MEMORY_TARGET = float(os.environ.get("KEEPALIVE_MEMORY_TARGET", "0.30"))

#: Hard ceiling on the ballast itself, independent of the target above. The
#: top-up arithmetic should never ask for more than this, and if it does, the
#: arithmetic is wrong and this is what stops it turning into an outage.
MEMORY_CAP_MB = int(os.environ.get("KEEPALIVE_MEMORY_CAP_MB", "3584"))

#: Seconds of CPU burn per period, and the period. 90 in 600 is 15% of samples,
#: three times what the 95th percentile needs, which leaves room for the metric
#: being averaged over minutes that do not line up with these bursts.
BUSY_S = float(os.environ.get("KEEPALIVE_BUSY_S", "90"))
PERIOD_S = float(os.environ.get("KEEPALIVE_PERIOD_S", "600"))

#: Burners. One is right for both shapes on offer: it is the whole of a 1 OCPU
#: micro and half of a 2 OCPU A1, and both are comfortably over 20%.
WORKERS = int(os.environ.get("KEEPALIVE_WORKERS", "1"))

#: Off switch, for a host where the load is real and this is just noise.
ENABLED = os.environ.get("KEEPALIVE_ENABLED", "1") not in {"0", "false", "no"}

#: Touched every cycle. The compose healthcheck reads its age, so a loop that
#: has wedged reports unhealthy even though the process is still there.
STAMP = Path(os.environ.get("KEEPALIVE_STAMP", "/tmp/keepalive.alive"))  # noqa: S108

CHUNK = 64 * 1024 * 1024
PAGE = 4096
MIB = 1024 * 1024

_stop = False


def _handle(signum: int, _frame: object) -> None:
    global _stop
    _stop = True
    log(f"signal {signum}, stopping")


def log(message: str) -> None:
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} keepalive: {message}", flush=True)


# ── Memory ────────────────────────────────────────────────────────────────


#: Overridable only so this can be exercised against a fixture; in the
#: container it is always the real one.
MEMINFO = Path(os.environ.get("KEEPALIVE_MEMINFO", "/proc/meminfo"))


def meminfo() -> tuple[int, int]:
    """Total and used bytes as the host sees them, not as this container does.

    /proc/meminfo is not namespaced, so a container reads the machine. That is
    the number Oracle's agent reports and therefore the only one worth
    steering. Used is total minus available rather than total minus free,
    because page cache is not pressure and counting it as such would make the
    ballast shrink to nothing on a host that is merely warm.
    """
    values: dict[str, int] = {}
    for line in MEMINFO.read_text(encoding="ascii").splitlines():
        key, _, rest = line.partition(":")
        if key in {"MemTotal", "MemAvailable", "MemFree"}:
            values[key] = int(rest.split()[0]) * 1024
    total = values.get("MemTotal", 0)
    # MemAvailable has been in every kernel since 3.14 and is the honest answer.
    # MemFree is the fallback and overstates pressure, which errs toward a
    # smaller ballast — the safe direction to be wrong in.
    free = values.get("MemAvailable", values.get("MemFree", total))
    return total, total - free


def wanted_bytes(total: int, used: int, held: int) -> int:
    """How large the ballast should be, given what the machine is doing.

    Split out from the resizing because this is where the one real bug lives:
    `used` includes the ballast, so it has to be subtracted back out. Skip that
    and every cycle reads its own allocation as somebody else's, releases it,
    and allocates it again a minute later, forever.
    """
    others = max(0, used - held)
    return max(0, min(int(total * MEMORY_TARGET) - others, MEMORY_CAP_MB * MIB))


class Ballast:
    """Anonymous pages held resident, resized toward a share of total RAM."""

    def __init__(self) -> None:
        self._chunks: list[bytearray] = []

    @property
    def size(self) -> int:
        return len(self._chunks) * CHUNK

    def retune(self, total: int, used: int) -> None:
        """Resize toward the gap between what everything else uses and target."""
        wanted = wanted_bytes(total, used, self.size) // CHUNK
        while len(self._chunks) > wanted:
            self._chunks.pop()
        while len(self._chunks) < wanted:
            self._chunks.append(self._fresh())

    @staticmethod
    def _fresh() -> bytearray:
        block = bytearray(CHUNK)
        # bytearray(n) is a lazily faulted mapping: the kernel promises zeroes
        # and hands over real pages only when they are written to. Untouched it
        # is a number in a process table and nothing a memory metric can see.
        for offset in range(0, CHUNK, PAGE):
            block[offset] = 1
        return block

    def refresh(self) -> None:
        """Rewrite one byte per page, so nothing drifts out to swap."""
        for block in self._chunks:
            for offset in range(0, CHUNK, PAGE):
                block[offset] = 1


# ── CPU ───────────────────────────────────────────────────────────────────


def burn(deadline: float) -> None:
    """Spin until the deadline, checking the clock rarely enough to be cheap."""
    total = 0
    while not _stop and time.monotonic() < deadline:
        for index in range(200_000):
            total += index * index
    if total < 0:  # pragma: no cover - keeps the loop from being optimised away
        log("impossible")


def worker() -> None:
    """One burner, in its own process.

    A process rather than a thread because the GIL would otherwise make the
    `WORKERS` knob a lie: two spinning threads share one interpreter and
    produce one core of load between them, which is not what anyone setting it
    to 2 is asking for. It also keeps the burst from starving the memory loop
    in the parent.
    """
    # Giving way is the whole point: at nice 19 a real request takes the core
    # back immediately rather than waiting behind the burst. `os.nice` is Unix
    # only, and the guard is what lets this be run on a laptop to watch it.
    if hasattr(os, "nice"):
        os.nice(19)
    signal.signal(signal.SIGTERM, _handle)
    while not _stop:
        burn(time.monotonic() + BUSY_S)
        resume = time.monotonic() + max(0.0, PERIOD_S - BUSY_S)
        while not _stop and time.monotonic() < resume:
            time.sleep(1)


# ── Main ──────────────────────────────────────────────────────────────────


def main() -> int:
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    total, _ = meminfo()
    log(
        f"host has {total / MIB:.0f} MiB; target {MEMORY_TARGET:.0%} memory, "
        f"{BUSY_S:.0f}s CPU per {PERIOD_S:.0f}s on {WORKERS} worker(s)"
    )
    if not ENABLED:
        log("KEEPALIVE_ENABLED is off — holding the process open and doing nothing")
        while not _stop:
            STAMP.write_text(str(time.time()), encoding="ascii")
            time.sleep(30)
        return 0

    burners = [multiprocessing.Process(target=worker, daemon=True) for _ in range(WORKERS)]
    for process in burners:
        process.start()

    ballast = Ballast()
    reported = 0.0
    while not _stop:
        total, used = meminfo()
        ballast.retune(total, used)
        ballast.refresh()
        STAMP.write_text(str(time.time()), encoding="ascii")

        # A burner that died takes the CPU half of this with it, silently and
        # for as long as nobody reads the logs. Restarting it here costs one
        # comparison a minute and removes the only way this quietly half-works.
        for index, process in enumerate(burners):
            if not process.is_alive():
                log(f"burner {index} had died, restarting it")
                burners[index] = multiprocessing.Process(target=worker, daemon=True)
                burners[index].start()

        now = time.monotonic()
        if now - reported > 900:
            reported = now
            share = (used / total) if total else 0.0
            log(
                f"memory {share:.0%} of {total / MIB:.0f} MiB "
                f"({ballast.size / MIB:.0f} MiB of it ballast)"
            )
        time.sleep(60)

    for process in burners:
        process.terminate()
    for process in burners:
        process.join(timeout=5)
    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
