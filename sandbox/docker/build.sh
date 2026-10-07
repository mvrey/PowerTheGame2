#!/bin/sh
# Builds the bot runtime images the Docker runner uses (see src/platform/node/languages.ts).
set -eu
cd "$(dirname "$0")"
docker build --pull -t jam-runtime-python:3.12 python
docker build --pull -t jam-runtime-node:22 node
docker image ls --digests | grep jam-runtime
