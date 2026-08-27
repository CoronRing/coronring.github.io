# Migrating off the 4 OCPU host

**Date:** 2026-08-27
**Reason:** Oracle halved the Always Free Ampere allowance and began terminating
instances above the new ceiling.
**Status:** new host live and serving; old host deliberately left running.

---

## 1. What changed at Oracle

Oracle reduced the Always Free `VM.Standard.A1.Flex` allowance from **4 OCPU /
24 GB** to **2 OCPU / 12 GB**, effective **2026-06-15**. In monthly terms that
is 3,000 OCPU-hours and 18,000 GB-hours down to 1,500 and 9,000.

There was no blog post and no announcement. The documentation was edited, and
people found out when instances stopped or when someone noticed the numbers had
moved. Oracle later emailed Always Free users to say that instances above the
new limits **on or after 2026-08-18 will be terminated**.

Reporting, for the record:

- [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)
- [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
- [heise online](https://www.heise.de/en/news/Oracle-halves-free-cloud-resources-11334516.html)

Accounts on Pay As You Go reportedly keep 4 OCPU / 24 GB free, though Oracle's
own documentation says the new limits apply to "all tenancies" while support
email says only free-tier accounts. **This tenancy's billing type has not been
confirmed**, which matters: see §6.

## 2. The two hosts

|                        | Old                                    | New                                    |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| Instance name          | `particle-wave-host`                   | `particle-wave-host-2c12g`             |
| Shape                  | `VM.Standard.A1.Flex`                  | `VM.Standard.A1.Flex`                  |
| OCPU / memory          | **4 / 24 GB**                          | **2 / 12 GB**                          |
| Public IP              | `129.146.37.132`                       | `129.146.25.154`                       |
| Base URL               | `https://129-146-37-132.sslip.io`      | `https://129-146-25-154.sslip.io`      |
| Chat API               | `https://129-146-37-132.sslip.io/chat` | `https://129-146-25-154.sslip.io/chat` |
| Created                | 2026-08-18                             | 2026-08-27                             |
| Availability domain    | `Bmae:PHX-AD-1`                        | `Bmae:PHX-AD-1`                        |
| Region                 | `us-phoenix-1`                         | `us-phoenix-1`                         |
| Within the new ceiling | no, double it                          | yes, exactly at it                     |

Both are running. Tenancy total is **6 OCPU / 36 GB**, three times the Always
Free ceiling.

The old host is left up on purpose, to observe when Oracle actually enforces
the limit. Its termination is the experiment. Nothing depends on it any more,
so losing it costs only the answer to that question.

**The old host still serves the previous build**, which has no `/api/embed`.
That endpoint 404s there, and the diff tool's semantic panel disables its remote
engine and says so rather than failing.

## 3. What the site points at

The frontend reads two variables and falls back to a compiled-in default:

| Variable                   | Consumer                       | Default in source     |
| -------------------------- | ------------------------------ | --------------------- |
| `PUBLIC_SITE_CHAT_API`     | `src/lib/site-chat-api.ts`     | the new host, `/chat` |
| `PUBLIC_PARTICLE_WAVE_API` | `src/lib/particle-wave-api.ts` | the new host          |

The defaults are the deployed truth, because GitHub Pages builds from CI where
no `.env` exists. Changing hosts therefore means editing those two defaults, not
just a variable. Both were repointed at the new host in the same commit as this
document.

To aim a local dev server elsewhere, set either variable in
`coronring.github.io/.env`.

## 4. Tuning done for 12 GB

The old numbers assumed four cores and 24 GB. What changed, and why:

| Setting                             | Was             | Now              | Reason                                                                                                                                                                                    |
| ----------------------------------- | --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARM` shape in `infra/provision.py` | 4 OCPU / 24 GB  | 2 OCPU / 12 GB   | The new ceiling. Anything larger is borrowed time.                                                                                                                                        |
| `PW_MAX_CONCURRENCY`                | 3               | 2                | The sampler is CPU-bound pure Python. Two cores, two conversions.                                                                                                                         |
| `PW_MAX_IMAGE_PIXELS`               | 40 MP (default) | 24 MP (explicit) | Peak memory scales with pixel count across several intermediate float arrays. Two concurrent 40 MP conversions on 12 GB is the shape of an OOM. 24 MP is still a full-frame camera image. |
| `app` container memory              | unlimited       | 6 GB             | Without a limit an oversized conversion OOM-kills its neighbours instead of failing its own request, turning one bad upload into an outage.                                               |
| `chat` container memory             | unlimited       | 2 GB             | IO-bound: it holds a corpus and waits on the provider.                                                                                                                                    |
| `caddy` container memory            | unlimited       | 512 MB           |                                                                                                                                                                                           |
| Swap in `infra/bootstrap.sh`        | 2 GB            | 4 GB             | The scipy and OpenCV build is the memory peak. That peak did not change; the headroom above it halved.                                                                                    |

`CHAT_MAX_CONCURRENCY` stays at 6. Those calls wait on the network, not the CPU,
so the figure is about the provider's patience rather than the host's cores.

## 5. How this was done

`infra/provision.py` gained two arguments, because it could not previously build
a second host at all: `launch()` hardcoded the display name and the reuse check
matched on it, so a run meant to create a replacement found the old host and
returned it, silently doing nothing.

```bash
# 1. Keep the old host's record. Gitignored; the public facts are in §2 above.
cp infra/state.json infra/state.legacy.json

# 2. Create the compliant host. --name is what makes it a second instance
#    rather than a no-op against the first.
python infra/provision.py --name particle-wave-host-2c12g

# 3. Bootstrap and deploy. Reads infra/state.json, which now names the new host.
python infra/configure.py

# 4. Verify, then repoint the frontend defaults and push.
curl -s https://129-146-25-154.sslip.io/chat/api/health
```

One failure worth recording, because it will happen again to anyone deploying
from Windows. The first bootstrap died with:

```
/usr/bin/env: 'bash\r': No such file or directory
```

`configure.py` tars the working tree directly, so git's `eol=lf` normalisation
never applies, and a CRLF `bootstrap.sh` reaches the host with a carriage return
in its shebang. The message names neither the file nor the cause.
`configure.py` now normalises the three uploaded text files to LF itself rather
than trusting the checkout.

## 6. Open questions

**Is this tenancy Always Free or Pay As You Go?** Unresolved, and it decides
whether the current state costs money. The compute API reports a service limit
of 37 to 41 A1 cores available, which is not the shape of a hard free-tier cap,
but service limits and the free allowance are enforced separately: Oracle
enforces the allowance by terminating instances, not by refusing a launch.

- If **Always Free**: running 6 OCPU / 36 GB should cost nothing and Oracle
  should eventually terminate something. Which instance it picks is not
  documented. It may take the old host, which is the intended outcome, or it may
  take whichever it likes.
- If **Pay As You Go**: the excess above the free allowance is billable, and
  leaving both up has a running cost.

Check under Billing and Cost Management in the console. If it is PAYG and the
experiment is not worth the spend, terminate the old host:

```bash
# Deliberately not scripted. Read the name back before running it.
python - <<'EOF'
import sys, pathlib
sys.path.insert(0, str(pathlib.Path("infra").resolve()))
import oci
from oci_common import load_config
cfg = load_config()
compute = oci.core.ComputeClient(cfg)
for i in compute.list_instances(compartment_id=cfg["tenancy"]).data:
    if i.display_name == "particle-wave-host" and not i.lifecycle_state.startswith("TERMINAT"):
        print("terminating", i.display_name, i.id)
        compute.terminate_instance(i.id, preserve_boot_volume=False)
EOF
```

**When does Oracle actually enforce?** The deadline was 2026-08-18 and the old
host was still running on 2026-08-27, nine days later, having been created on
the deadline itself. So enforcement is not immediate. Watching it is the reason
the old host is still up.

## 7. Rolling back

The old host still runs the previous build and answers on its own URL. To go
back, set the two defaults in §3 to `129-146-37-132.sslip.io` and push. The
only thing lost is `/api/embed`, so the diff tool's remote engine goes dark and
says why.

`infra/state.legacy.json` holds the old host's OCID and key path for anything
that needs to talk to it directly.
