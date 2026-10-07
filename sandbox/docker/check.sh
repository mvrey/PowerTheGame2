#!/bin/sh
# Runs the sandbox tests (escape attempts, memory, fork bombs) against the real runtime.
# Needs Docker, the images from build.sh and, for the recommended setup, gVisor (runsc).
#   JAM_DOCKER_RUNTIME=runsc sh sandbox/docker/check.sh      # with gVisor
#   JAM_DOCKER_RUNTIME= sh sandbox/docker/check.sh           # plain Docker
set -eu
cd "$(dirname "$0")/../.."
npx vitest run tests/platform/adversarial.test.ts
