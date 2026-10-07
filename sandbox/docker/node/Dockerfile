# Runtime for JavaScript bots: Node and its built-in modules, nothing else.
# For a tournament, pin the base image by digest (node:22-alpine@sha256:...) and record it.
FROM node:22-alpine

# Bots get no packages and no network: the package managers are only attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn*

WORKDIR /bot
# The runner chooses the user (65534, nobody), mounts the bot read-only at /bot and starts it.
