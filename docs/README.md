# Documentation

Start here before changing anything structural.

| Document                               | Contents                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`SYSTEM.md`](./SYSTEM.md)             | **Read first.** The four components, what depends on what, the `.pwcloud` and HTTP contracts, both deploy paths, and the traps |
| [`.temp/DESIGN.md`](./.temp/DESIGN.md) | The Astro site: structure, layout, design system, particle engine, accessibility, copy register, and the decision log          |

Component-level documents live with their component:

| Document                                                 | Contents                                   |
| -------------------------------------------------------- | ------------------------------------------ |
| [`../backend/README.md`](../backend/README.md)           | Running and configuring the Python service |
| [`../backend/docs/design.md`](../backend/docs/design.md) | Service API, security, cost, and history   |
| [`../infra/README.md`](../infra/README.md)               | Provisioning and deploying the Oracle host |

There is also a Claude Code skill at
[`../.claude/skills/coronring-site/SKILL.md`](../.claude/skills/coronring-site/SKILL.md)
covering environments, the deploy checks, commit discipline, and the house
writing style.

## Conventions

- **`.temp/`** holds drafts that are still moving. When a document stabilises, promote it out of `.temp/` and bump its version.
- Every design doc carries a version and a last-updated date in its header.
- Work that goes beyond what a design doc describes updates that doc in the same change, and bumps the version once.
- If the code and the docs disagree, the docs are wrong. Fix them.
