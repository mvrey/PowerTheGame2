# Runtime for Python bots: the interpreter and its standard library, nothing else.
# For a tournament, pin the base image by digest (python:3.12-slim@sha256:...) and record it.
FROM python:3.12-slim

# Bots get no packages and no network: the package manager is only attack surface.
RUN rm -rf /usr/local/lib/python3.12/site-packages/pip* /usr/local/bin/pip* \
 && rm -rf /usr/local/lib/python3.12/ensurepip

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8
WORKDIR /bot
# The runner chooses the user (65534, nobody), mounts the bot read-only at /bot and starts it.
