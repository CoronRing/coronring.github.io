# The one container here with no dependencies and nothing to install, so it is
# the base image and a single file. Alpine because this image exists to sit
# still: the less of it there is, the less of it needs patching later.
#
# A pinned minor rather than `3-alpine`, so a rebuild in six months produces
# the container that was tested rather than whatever is current that morning.
FROM python:3.12-alpine

WORKDIR /srv
COPY keepalive.py .

# Nothing here reads a secret, opens a socket, or writes outside /tmp, so there
# is no reason for it to be root while it does that.
USER nobody

# Unbuffered, because the only way to see this working is `docker compose logs`
# and a block-buffered pipe would hold a quarter-hourly line for most of a day.
CMD ["python", "-u", "keepalive.py"]
