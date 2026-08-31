#!/bin/sh
# deepseek-base installer.
#
#   sh setup.sh <target-repo-dir>
#
# Copies the managed surface into the target repository. A project-owned file that
# already exists is never overwritten; a managed file that differs is written beside
# the original as <file>.deepseek-base-new, so the change is reviewed rather than
# applied silently.
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: sh setup.sh <target-repo-dir>" >&2
  exit 2
fi
TARGET="$1"
if [ ! -d "$TARGET" ]; then
  echo "setup: target directory does not exist: $TARGET" >&2
  exit 2
fi

SRC=$(cd "$(dirname "$0")" && pwd)
DST=$(cd "$TARGET" && pwd)

if [ "$SRC" = "$DST" ]; then
  echo "setup: refusing to install into the scaffold itself" >&2
  exit 2
fi

COPIED=0
UNCHANGED=0
STAGED=0
KEPT=0

copy_managed () {
  rel="$1"
  from="$SRC/$rel"
  to="$DST/$rel"
  [ -f "$from" ] || return 0
  mkdir -p "$(dirname "$to")"
  if [ ! -f "$to" ]; then
    cp "$from" "$to"
    COPIED=$((COPIED + 1))
    return 0
  fi
  if cmp -s "$from" "$to"; then
    UNCHANGED=$((UNCHANGED + 1))
    return 0
  fi
  cp "$from" "$to.deepseek-base-new"
  echo "  differs, staged for review: $rel.deepseek-base-new" >&2
  STAGED=$((STAGED + 1))
}

copy_once () {
  rel="$1"
  if [ -f "$DST/$rel" ]; then
    echo "  kept project file: $rel" >&2
    KEPT=$((KEPT + 1))
    return 0
  fi
  copy_managed "$rel"
}

echo "deepseek-base: installing into $DST" >&2

LIST=$(cd "$SRC" && find .dsh docs scripts -type f 2>/dev/null | sed 's|^\./||' | sort)

for rel in $LIST; do
  case "$rel" in
    .dsh/base/state/*) continue ;;
    .dsh/base/evidence/*) continue ;;
    .dsh/base/receipts/*) continue ;;
    .dsh/base/waivers/*) continue ;;
    .dsh/base/catalog.json) continue ;;
  esac
  copy_managed "$rel"
done

# Project-owned files: seeded once, never replaced.
copy_once AGENTS.md
copy_once progress.md
copy_once .editorconfig
copy_once .gitattributes
copy_once cordis.patch.yml

if [ ! -f "$DST/.dsh/base/catalog.json" ]; then
  echo "  governance stays OFF until you copy catalog.example.json to catalog.json" >&2
fi

chmod +x "$DST/.dsh/base/githooks/pre-commit" 2>/dev/null || true
chmod +x "$DST/.dsh/base/githooks/commit-msg" 2>/dev/null || true
chmod +x "$DST/.dsh/base/githooks/pre-push" 2>/dev/null || true

echo "" >&2
echo "copied $COPIED, unchanged $UNCHANGED, staged for review $STAGED, kept $KEPT" >&2
echo "" >&2
echo "Next:" >&2
echo "  cd $DST" >&2
echo "  git config core.hooksPath .dsh/base/githooks" >&2
echo "  cp .dsh/base/catalog.example.json .dsh/base/catalog.json    # then edit it" >&2
echo "  node .dsh/base/dsb.mjs doctor" >&2
echo "  node .dsh/base/dsb.mjs catalog-lint" >&2
