# Runtime image for the particle-wave service. Built on the Oracle host by
# `infra/configure.py`; portable to any container platform unchanged.

# Overridable so the image can be built from a registry mirror when Docker Hub
# is unreachable or rate-limited:
#   docker build --build-arg BASE_IMAGE=mirror.gcr.io/library/python:3.11-slim .
ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

# libgomp1: OpenMP runtime. Some manylinux builds of OpenCV and SciPy link it
# dynamically and the slim base does not carry it. The pipeline falls back to
# SciPy and Pillow if cv2 will not import, so a missing library degrades
# quietly rather than failing — which is exactly why it is worth installing
# explicitly instead of finding out from a slow code path much later.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# A fixed non-root UID: files copied in are readable and $HOME is writable,
# which Python and Pillow both expect, and nothing runs as root.
RUN useradd --create-home --uid 1000 app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/app

WORKDIR /home/app/service

# Dependencies first: they change far less often than the application code, so
# this layer stays cached across ordinary edits.
#
# vendor/ holds an unreleased wheel when one is being tested:
# `scripts/sync_wheel.py` drops it there and repins requirements.txt at it. On
# the released path the directory holds only its README and pip resolves the
# pin from PyPI.
#
# The directory is tracked (hence the README) rather than optional, because a
# COPY whose every source matches nothing is not portable. This was
# `COPY vendo[r] ./vendor`, and the `[r]` trick only tolerates a zero match on
# BuildKit — the classic builder, which Azure ACR Tasks uses, fails the whole
# build with "no source files were specified". The idiom needs a sibling source
# that does match to be safe, and there is none here. Keeping the directory
# present makes a plain COPY correct on every builder.
COPY --chown=app:app requirements.txt ./
COPY --chown=app:app vendor ./vendor
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app service ./service
COPY --chown=app:app static ./static

# Drop privileges before anything listens on a socket.
USER app

EXPOSE 7860

# Single worker on purpose. The in-process rate limiter and the concurrency
# semaphore are per-process, so a second worker would quietly double both
# limits. Parallelism is configured with PW_MAX_CONCURRENCY instead.
#
# $PORT is honoured so the same image runs unchanged on hosts that inject a
# port (Render, Cloud Run, Fly); 7860 is the default Caddy proxies to.
# `exec` keeps uvicorn as PID 1 so it receives SIGTERM directly on shutdown.
CMD ["sh", "-c", "exec uvicorn service.main:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1"]
