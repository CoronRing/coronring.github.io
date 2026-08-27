"""
Install the runtime on the provisioned host and start the service.

    python infra/configure.py           # bootstrap + deploy
    python infra/configure.py --deploy  # skip bootstrap, just redeploy
    python infra/configure.py --logs    # tail the running stack

Reads `state.json` written by provision.py. Uploads the service source, the
compose stack, and a bootstrap script; then builds and starts everything over
SSH. Safe to re-run — the bootstrap is idempotent and a redeploy reuses the
already-issued TLS certificate.
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STATE_FILE = HERE / "state.json"
SOURCE = ROOT / "backend"
CHAT_SOURCE = ROOT / "chat"
REMOTE = "/home/ubuntu/particle-wave"

# Never ship local build output or virtualenvs to the host: they are large,
# platform-specific, and the host rebuilds everything from source anyway.
EXCLUDE = {
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".git",
    "node_modules",
    ".env",
}


def state() -> dict:
    if not STATE_FILE.is_file():
        raise SystemExit("No state.json — run provision.py first.")
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def ssh_base(info: dict) -> list[str]:
    return [
        "ssh",
        "-i",
        info["ssh_key"],
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "UserKnownHostsFile=" + str(HERE / "known_hosts"),
        "-o",
        "ConnectTimeout=15",
        f"{info['ssh_user']}@{info['public_ip']}",
    ]


def run_remote(info: dict, command: str, *, check: bool = True, quiet: bool = False):
    result = subprocess.run(  # noqa: S603
        [*ssh_base(info), command],
        capture_output=quiet,
        text=True,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() if quiet else ""
        raise SystemExit(f"remote command failed ({result.returncode}): {command}\n{detail}")
    return result


def wait_for_ssh(info: dict, timeout: float = 420) -> None:
    """A freshly launched instance answers the API before sshd is listening."""
    print(f"waiting for ssh on {info['public_ip']}")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = run_remote(info, "true", check=False, quiet=True)
        if result.returncode == 0:
            print("  connected")
            return
        time.sleep(10)
    raise SystemExit(
        "Could not reach the host over SSH.\n"
        "Check the instance is RUNNING and that port 22 is open in the security list."
    )


def add_unix_text(archive: tarfile.TarFile, path: Path, arcname: str) -> None:
    """
    Add a text file with LF line endings, whatever the working tree has.

    This exists because of a failure that cost a deploy. The repository
    declares `* text=auto eol=lf`, but a checkout predating that attribute, or
    any tool that rewrites a file through Python default newline translation
    on Windows, leaves CRLF on disk. `tarfile.add` copies bytes, so the CRLF
    travels to the host, and a shell script whose shebang ends in a carriage
    return fails with

        /usr/bin/env: 'bash\r': No such file or directory

    which names neither the file nor the real cause. Normalising here rather
    than trusting the checkout makes the upload correct from any machine, and
    is cheap: these are three small text files.
    """
    body = path.read_bytes().replace(b"\r\n", b"\n")
    info = tarfile.TarInfo(name=arcname)
    info.size = len(body)
    info.mtime = int(path.stat().st_mtime)
    # Executable for the script, ordinary for the configs.
    info.mode = 0o755 if path.suffix == ".sh" else 0o644
    archive.addfile(info, io.BytesIO(body))


def make_archive() -> Path:
    """Tar the service source, pruning anything the host should rebuild."""
    tmp = Path(tempfile.gettempdir()) / "particle-wave-src.tar.gz"

    def keep(item: tarfile.TarInfo) -> tarfile.TarInfo | None:
        parts = set(Path(item.name).parts)
        if parts & EXCLUDE or item.name.endswith(".pyc"):
            return None
        return item

    with tarfile.open(tmp, "w:gz") as archive:
        archive.add(SOURCE, arcname="app", filter=keep)
        archive.add(CHAT_SOURCE, arcname="chat", filter=keep)
        for extra in ("compose.yml", "Caddyfile", "bootstrap.sh"):
            add_unix_text(archive, HERE / extra, extra)

    print(f"  archive {tmp.stat().st_size / 1024:.0f} kB")
    return tmp


def upload(info: dict, archive: Path) -> None:
    run_remote(info, f"mkdir -p {REMOTE}", quiet=True)
    print("  uploading")
    result = subprocess.run(  # noqa: S603
        [  # noqa: S607 - scp is resolved from PATH, as an ssh client should be
            "scp",
            "-i",
            info["ssh_key"],
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "UserKnownHostsFile=" + str(HERE / "known_hosts"),
            str(archive),
            f"{info['ssh_user']}@{info['public_ip']}:{REMOTE}/src.tar.gz",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"upload failed: {result.stderr.strip()}")

    # Replace the source trees wholesale so deleted files do not linger, but
    # keep the compose volumes (and therefore the TLS certificate) untouched.
    # `chat.env` lives alongside them and is deliberately not in the archive,
    # so it survives every redeploy — see `upload_secrets`.
    run_remote(
        info,
        f"cd {REMOTE} && rm -rf app chat && tar xzf src.tar.gz && rm src.tar.gz",
        quiet=True,
    )


# ──────────────────────────────────────────────────────────────────────────
# Secrets
# ──────────────────────────────────────────────────────────────────────────

# Where the operator's keys are read from. Kept outside the repo tree on
# purpose: this file is the one thing in the deployment that must never be
# committed, and the surest way to guarantee that is for it to live somewhere
# `git add .` in this repo cannot reach.
LOCAL_ENV = ROOT.parent / ".env"


#: Names the keys may appear under in the operator's .env, in priority order.
#:
#: `CHAT_GEMINI_API_KEYS` is what the service itself reads and what the .env
#: actually defines. `GOOGLE_AI_API_KEYS` was the name this script looked for,
#: and only that one, so a correctly configured .env produced a deployment with
#: keys=0 and a chat service reporting `degraded` for no visible reason. Both
#: are accepted now, because guessing which of two names an operator used is
#: cheaper than a silent misconfiguration.
KEY_NAMES = ("CHAT_GEMINI_API_KEYS", "GOOGLE_AI_API_KEYS")


def read_gemini_keys() -> tuple[str, str]:
    """
    Pull the Gemini keys out of the operator's local .env.

    Returned verbatim rather than reformatted. The service's own parser already
    handles the three shapes this value turns up in (CSV, JSON array, and the
    bracketed-unquoted form this .env uses) and re-encoding it here would mean
    two parsers that have to agree forever.

    :returns: ``(value, name)`` where `name` is the variable it came from, or
        ``("", "")`` when neither name is present.
    """
    if not LOCAL_ENV.is_file():
        return "", ""
    lines = LOCAL_ENV.read_text(encoding="utf-8", errors="replace").splitlines()
    for name in KEY_NAMES:
        prefix = f"{name}="
        for line in lines:
            if line.startswith(prefix):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value, name
    return "", ""


def upload_secrets(info: dict) -> bool:
    """
    Write `chat.env` onto the host, readable only by the owner.

    Written over SSH stdin rather than scp'd from a temp file, so the keys never
    touch the local disk outside the .env they came from. `chmod` runs before
    the content is written, closing the window where the file exists with a
    default mode.

    A deployment with no keys is allowed to proceed: the chat service starts,
    reports `degraded`, and refuses to answer — which is a far more diagnosable
    outcome than a container that will not boot.

    :returns: True if keys were written.
    """
    keys, source = read_gemini_keys()
    if not keys:
        names = " or ".join(KEY_NAMES)
        print(f"  no {names} in {LOCAL_ENV} — chat will start unconfigured")
        # Still write the file: compose `env_file` fails hard if it is missing.
        keys = ""
    else:
        print(f"  keys read from {source}")

    remote_path = f"{REMOTE}/chat.env"
    command = (
        f"umask 077 && touch {remote_path} && chmod 600 {remote_path} && "
        f"cat > {remote_path}"
    )
    result = subprocess.run(  # noqa: S603
        [*ssh_base(info), command],
        input=f"CHAT_GEMINI_API_KEYS={keys}\n",
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"could not write chat.env: {result.stderr.strip()}")

    if keys:
        count = len([k for k in keys.strip("[]").split(",") if k.strip()])
        print(f"  chat.env written ({count} key(s))")
    return bool(keys)


def deploy(info: dict) -> None:
    host = info["hostname"]
    print(f"\nbuilding and starting the stack (site: {host})")
    print("  first build compiles wheels for ARM; expect a few minutes")

    # `sg docker` runs with the group membership the bootstrap just granted,
    # which the current SSH session would otherwise not pick up until relogin.
    command = (
        f"cd {REMOTE} && SITE_ADDRESS={host} "
        "sg docker -c 'docker compose up -d --build'"
    )
    run_remote(info, command)

    # Caddy reads its config from a bind-mounted file, so editing the Caddyfile
    # changes nothing that compose can see: the container spec is identical, the
    # container is left running, and the new routing is silently not applied.
    # This cost an hour exactly once — a new backend deployed, healthy, and
    # unreachable, because every request still went to the old catch-all.
    #
    # `docker compose exec caddy caddy reload` is the graceful fix and is what
    # the documentation suggests. It was tried here and did *not* take effect:
    # the adapter reported success and the routing was unchanged. Restarting the
    # container does take effect, costs about a second, and keeps the
    # certificate (it lives in a named volume, not the container). Correctness
    # beats elegance for a step whose failure mode is silent.
    print("  restarting caddy to pick up the Caddyfile")
    run_remote(
        info,
        f"cd {REMOTE} && SITE_ADDRESS={host} sg docker -c 'docker compose restart caddy'",
    )


def verify(info: dict) -> int:
    host = info["hostname"]
    print("\nverifying")

    # Check *through Caddy*, not at the app's own port. The app container only
    # `expose`s 7860 to the compose network — it is deliberately not published
    # to the host — so probing 127.0.0.1:7860 can never succeed and reports a
    # perfectly healthy deployment as broken. Ask for it the way a visitor
    # would, but over loopback, which isolates "app or proxy is down" from
    # "DNS or the certificate is not ready yet".
    local_probe = (
        f"curl -fsS -m 5 --resolve {host}:443:127.0.0.1 https://{host}/api/health || true"
    )
    for _ in range(30):
        result = run_remote(info, local_probe, check=False, quiet=True)
        if '"status":"ok"' in (result.stdout or ""):
            print("  app healthy behind the proxy")
            break
        time.sleep(10)
    else:
        print("  app did not become healthy — see --logs")
        return 1

    # Then over the public name, which also proves the certificate was issued.
    import urllib.error
    import urllib.request

    for attempt in range(30):
        try:
            with urllib.request.urlopen(f"https://{host}/api/health", timeout=15) as response:
                payload = json.load(response)
            print(f"  https://{host} -> {payload['status']} (v{payload['version']})")
            break
        except Exception as exc:  # noqa: BLE001 - any failure means "not ready yet"
            if attempt == 0:
                print(f"  waiting for the certificate ({type(exc).__name__})")
            time.sleep(10)
    else:
        print(f"  https://{host} never answered — check `--logs`")
        return 1

    # The chat service is a separate container behind the same certificate, so
    # it gets its own probe. A `degraded` answer is reported rather than failed:
    # it means the container is up and telling us the keys or the corpus are
    # missing, which a deploy failure would obscure rather than explain.
    for attempt in range(18):
        try:
            with urllib.request.urlopen(f"https://{host}/chat/api/health", timeout=15) as response:
                payload = json.load(response)
            corpus = payload.get("corpus", {})
            print(
                f"  https://{host}/chat -> {payload['status']} "
                f"(keys={payload.get('keys')}, "
                f"corpus={'yes' if corpus.get('loaded') else 'no'})"
            )
            if payload["status"] != "ok":
                print("    chat is degraded — see `--logs` for the reason")
            return 0
        except Exception as exc:  # noqa: BLE001
            if attempt == 0:
                print(f"  waiting for chat ({type(exc).__name__})")
            time.sleep(10)

    print("  chat never answered — check `--logs`")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true", help="Skip host bootstrap.")
    parser.add_argument("--logs", action="store_true", help="Tail the stack and exit.")
    args = parser.parse_args()

    info = state()
    print(f"host    : {info['public_ip']}  ({info['shape']})")
    print(f"site    : https://{info['hostname']}")

    if args.logs:
        # SITE_ADDRESS is only consumed by Caddy, but compose warns on every
        # command when it is unset, which buries the log output being asked for.
        run_remote(
            info,
            f"cd {REMOTE} && SITE_ADDRESS={info['hostname']} "
            "sg docker -c 'docker compose logs --tail 80'",
        )
        return 0

    wait_for_ssh(info)

    if not args.deploy:
        print("\nbootstrapping host")
        upload(info, make_archive())
        run_remote(info, f"chmod +x {REMOTE}/bootstrap.sh && {REMOTE}/bootstrap.sh")
    else:
        print("\nuploading source")
        upload(info, make_archive())

    print("\nwriting secrets")
    upload_secrets(info)

    deploy(info)
    return verify(info)


if __name__ == "__main__":
    sys.exit(main())
