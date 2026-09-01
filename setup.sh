#!/bin/sh
# dsh-base installer (POSIX wrapper).
#
#   sh setup.sh <target-repo-dir> [more targets...] [--dry-run] [--enable] [--hooks] [--verify]
#
# The installation logic lives in .dsh/base/install.mjs so there is exactly one
# implementation to maintain. This wrapper only locates it and checks for node.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "setup: node 20 or later is required and was not found on PATH" >&2
  exit 2
fi

exec node "$DIR/.dsh/base/install.mjs" "$@"
