# Runtime image for the site-chat service. Built on the Oracle host by
# `infra/configure.py`; portable to any container platform unchanged.

ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

# A fixed non-root UID, matching the particle-wave image next door.
RUN useradd --create-home --uid 1000 app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/app

WORKDIR /home/app/service

# Dependencies first: they change far less often than the code above them.
COPY --chown=app:app requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app service ./service

USER app

EXPOSE 7870

# Single worker, as next door. The rate limiter, the answer cache, the key-ring
# cooldowns, and the concurrency semaphore are all per-process; a second worker
# would quietly double every limit and halve the answer cache's hit rate.
CMD ["sh", "-c", "exec uvicorn service.main:app --host 0.0.0.0 --port ${PORT:-7870} --workers 1"]
