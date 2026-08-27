# infra

Provisions the Oracle Cloud always-free host that runs the particle-wave
backend in [`../backend`](../backend), and deploys the service onto it.

Nothing here is secret — the whole site is open source — but nothing here is
built or published by the GitHub Pages workflow either. It is operator
tooling, run by hand from a checkout.

## Why Oracle

Hugging Face began charging for Docker Spaces in 2026, and the one free
combination that runs Python (Gradio on ZeroGPU) terminates any app that
isn't a Gradio app launched through `demo.launch()`. Oracle's always-free
tier gives 4 ARM cores and 24 GB, permanently, which is far more than this
service needs. See [`../backend/docs/design.md`](../backend/docs/design.md)
§10 for the full trail.

## Usage

```bash
python infra/provision.py          # create network + instance
python infra/configure.py          # install Docker, build, start
python infra/configure.py --deploy # redeploy after a code change
python infra/configure.py --logs   # tail the running stack
python infra/provision.py --show   # what exists right now
python infra/package_zip.py        # zips for a different host, see below
```

Both scripts are safe to re-run. Provisioning is find-or-create keyed on
display name, so a half-finished attempt is completed rather than duplicated —
which matters, because the always-free allowance has room for roughly one of
these and a stray second VCN is easy to miss in the console.

## What gets created

| Resource         | Name                   | Notes                                                   |
| ---------------- | ---------------------- | ------------------------------------------------------- |
| VCN              | `particle-wave-vcn`    | 10.0.0.0/16                                             |
| Internet gateway | `particle-wave-igw`    | default route 0.0.0.0/0                                 |
| Security list    | _(VCN default)_        | opens 22, 80, 443 + ICMP                                |
| Subnet           | `particle-wave-subnet` | 10.0.1.0/24, public                                     |
| Instance         | `particle-wave-host`   | `VM.Standard.A1.Flex`, 4 OCPU / 24 GB, Ubuntu 24.04 ARM |

State lands in `state.json` (gitignored). Credentials live outside the repo
entirely: the SSH key at `~/.ssh/oracle_particle_wave`, the OCI API signing
key at `~/.oci/particle-wave.pem`, and the tenancy details in the gitignored
`.env` at the repository root.

## Logs

Container logs are capped in `compose.yml` at 10 MB x 3 files per service.
Docker's `json-file` driver defaults to _unlimited_, so before this the disk was
the only bound and the first symptom of hitting it would have been the whole
host failing rather than anything log-shaped.

Read them back over the window you care about:

```bash
python infra/configure.py --logs                  # live tail, all services
ssh ... 'cd /opt/particle-wave && docker compose logs --since 24h app'
ssh ... 'cd /opt/particle-wave && docker compose logs --since 1h --tail 200 chat'
```

**There is no custom log endpoint on the service, on purpose.** Oracle already
provides one: the Unified Monitoring Agent is installed and active on this host
(`oci-managementagent` and `unifiedmonitoring` are among the Oracle Cloud Agent
plugins), so container logs can be shipped into OCI Logging and queried from the
console or the CLI with the same API signing key `provision.py` already uses.
Enabling it is console work rather than anything in this repo:

1. **Observability & Management -> Logging -> Log groups** — create one.
2. **Logs -> Create custom log**, agent configuration pointed at
   `/var/lib/docker/containers/*/*-json.log`.
3. Add the dynamic group and IAM policy the wizard prints, so the instance may
   write to the log group.

That path was chosen over building an authenticated `/api/logs` route because a
log-reading endpoint on a public host is a new secret to rotate, a new way to
leak request contents, and a new thing to get wrong — for something the platform
already does behind credentials that exist.

## Two traps worth knowing

**Opening a port in OCI is two jobs, not one.** Oracle's Ubuntu images ship an
iptables `INPUT` chain that REJECTs everything except SSH, _on top of_ the
cloud security list. Open the port in the console alone and it reads as open
from the API while being dead from a browser. `bootstrap.sh` does both halves
and persists the host rules across reboots.

**HTTPS is mandatory, so the host needs a name.** The website is served over
HTTPS from github.io, and a page loaded over HTTPS cannot call an `http://`
backend — browsers block it as mixed content. Certificates need a hostname,
not a bare IP, so the stack uses `<ip-with-dashes>.sslip.io`, which resolves
to the IP for free. Caddy obtains and renews the certificate automatically.
Point a real domain at the host later and only `SITE_ADDRESS` changes.

The Caddy data volume is named so the certificate survives a redeploy.
Recreating it every time would walk into Let's Encrypt's rate limit.

## Capacity

`VM.Standard.A1.Flex` is frequently unobtainable in busy regions; Oracle
answers `OutOfHostCapacity`, which is a real answer rather than a transient
one. `provision.py` tries all three Phoenix availability domains before giving
up, and suggests `--micro` (AMD, 1 OCPU / 1 GB, always available) as the
fallback. Note that 1 GB is tight for numpy + scipy + OpenCV, which is why
`bootstrap.sh` adds swap regardless of shape.

## Taking the services somewhere else

Both services are ordinary containers — nothing in either image knows about
Oracle. `package_zip.py` packages them for a provider that wants an upload
rather than an SSH host:

```bash
python infra/package_zip.py            # all three, into dist-docker/
python infra/package_zip.py --only app # just the particle-wave zip
python infra/package_zip.py --tag git  # suffix filenames with the short commit
```

| Artefact                    | Shape                            | For                                      |
| --------------------------- | -------------------------------- | ---------------------------------------- |
| `particle-wave-backend.zip` | `Dockerfile` at the zip root     | a provider that builds one image per app |
| `site-chat.zip`             | `Dockerfile` at the zip root     | same, for the other service              |
| `coronring-be-stack.zip`    | `compose.yml` + `app/` + `chat/` | a provider that accepts a compose file   |

Each carries a generated `DEPLOY.md` with the port, the health path, and the
environment variables to paste into the provider's form — the same values
`compose.yml` sets here, so a zip deploy behaves like this host.

Two things the zips deliberately drop:

**Caddy.** A managed platform terminates TLS itself. Ours would be a second
certificate manager in the path, and it could not bind `:443` anyway. Caddy is
also what mounts the chat service under `/chat` and strips the prefix, so on a
platform that gives each service its own hostname the chat service answers at
its root and `PUBLIC_SITE_CHAT_API` loses that suffix.

**Secrets.** `CHAT_GEMINI_API_KEYS` is never written into an artefact. The
generated docs name it; setting it is the operator's job in the provider's UI.

The zips prune the same paths `configure.py` does, and entries are sorted with
fixed timestamps, so rebuilding an unchanged tree produces a byte-identical
zip. `dist-docker/` is gitignored — the artefacts derive entirely from tracked
source, so there is nothing there worth versioning.

### Hosts that build from source

Some platforms do not want a build context at all. They take a source archive,
run the build themselves, and restore dependencies from `requirements.txt`.
`git archive` is the right tool there, and needs nothing from this directory:

```bash
git archive --format=zip --output agent-source.zip HEAD:backend
```

`HEAD:<dir>` makes that subtree the archive root, so `Dockerfile` and
`requirements.txt` land at the top level where a builder expects them. Plain
`HEAD` would archive the whole repository, site included.

Two things to know. It archives **the commit, not the working tree**, so
uncommitted edits are silently omitted; commit first. And it includes only
tracked files, which is what keeps `.venv` and secrets out for free.

Nothing about this replaces the Oracle path; it runs beside it, and neither
knows about the other.

## Tearing it down

There is no teardown script, deliberately — destroying infrastructure from a
script someone runs by accident is worse than doing it by hand. Terminate the
instance in the console, then delete the subnet, gateway, and VCN in that
order.
