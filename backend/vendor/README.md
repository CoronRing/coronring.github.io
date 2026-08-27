# vendor

Where an **unreleased** `particle_wave` wheel goes while it is being tested.

On the released path this directory holds nothing but this file, and
`requirements.txt` pins `particle-wave==<version>` from PyPI. To test a build
that is not published yet:

```bash
python scripts/sync_wheel.py     # builds the wheel, drops it here, repins requirements.txt
```

Undo it by restoring the PyPI pin in `requirements.txt` and deleting the
`.whl`. Nothing in `service/` changes either way; it only ever imports the
package by name.

## Why this file exists

The directory is tracked so that it always exists, because `Dockerfile` copies
it unconditionally.

It used to be optional, via `COPY vendo[r] ./vendor`. That idiom only tolerates
a source matching zero files on BuildKit. The classic builder, which Azure ACR
Tasks uses, fails the whole build with `COPY failed: no source files were
specified` — and it only ever works when the same `COPY` has a sibling source
that does match, which this one does not. Keeping the directory present makes a
plain `COPY` correct on every builder, which matters because the image is meant
to run unchanged on any container platform.

Do not delete this file to tidy up. An empty directory is not something git can
track, so removing it removes the directory and breaks the build.
