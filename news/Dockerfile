# Runtime image for the NewsRing subscriptions service. Built on the Oracle
# host by `infra/configure.py`; portable to any container platform unchanged.

ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

# A fixed non-root UID, matching the two images next door. It has to match the
# ownership of the data volume too: the subscriber database is the only file
# this service writes, and a root-owned volume would make it read-only.
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

# The mount point for the named volume that holds the list. Created here, as
# the right user, so the container does not need root to write to it on a
# first boot against an empty volume.
RUN mkdir -p /data && chown app:app /data
VOLUME ["/data"]

USER app

EXPOSE 7880

# Single worker. The rate limiter, the confirmation cooldown, the digest cache
# and the broadcast lock are all per process; a second worker would double
# every limit and let two broadcasts run at once.
CMD ["sh", "-c", "exec uvicorn service.main:app --host 0.0.0.0 --port ${PORT:-7880} --workers 1"]
