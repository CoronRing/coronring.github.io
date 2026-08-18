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
```

Both scripts are safe to re-run. Provisioning is find-or-create keyed on
display name, so a half-finished attempt is completed rather than duplicated —
which matters, because the always-free allowance has room for roughly one of
these and a stray second VCN is easy to miss in the console.

## What gets created

| Resource | Name | Notes |
| --- | --- | --- |
| VCN | `particle-wave-vcn` | 10.0.0.0/16 |
| Internet gateway | `particle-wave-igw` | default route 0.0.0.0/0 |
| Security list | *(VCN default)* | opens 22, 80, 443 + ICMP |
| Subnet | `particle-wave-subnet` | 10.0.1.0/24, public |
| Instance | `particle-wave-host` | `VM.Standard.A1.Flex`, 4 OCPU / 24 GB, Ubuntu 24.04 ARM |

State lands in `state.json` (gitignored). Credentials live outside the repo
entirely: the SSH key at `~/.ssh/oracle_particle_wave`, the OCI API signing
key at `~/.oci/particle-wave.pem`, and the tenancy details in the gitignored
`.env` at the repository root.

## Two traps worth knowing

**Opening a port in OCI is two jobs, not one.** Oracle's Ubuntu images ship an
iptables `INPUT` chain that REJECTs everything except SSH, *on top of* the
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

## Tearing it down

There is no teardown script, deliberately — destroying infrastructure from a
script someone runs by accident is worse than doing it by hand. Terminate the
instance in the console, then delete the subnet, gateway, and VCN in that
order.
