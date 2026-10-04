#!/bin/bash
set -euo pipefail

PROJECT_DIR="$HOME/Code/training-web"
SERVER="harrisserver"
SERVER_WEB_DIR="/opt/training/web"
ARCHIVE_NAME="training-web-deploy.tar.gz"
LOCAL_ARCHIVE="${TMPDIR:-/tmp}/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"
DRY_RUN=false
VERSION_METADATA_CREATED=false

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [--dry-run]"
  exit 2
fi
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
elif [ "$#" -eq 1 ]; then
  echo "Usage: $0 [--dry-run]"
  exit 2
fi

cleanup() {
  rm -f "$LOCAL_ARCHIVE"
  if [ "$VERSION_METADATA_CREATED" = true ]; then
    rm -f "$PROJECT_DIR/.deployment-version.json"
  fi
}
trap cleanup EXIT

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Local project folder not found: $PROJECT_DIR"
  exit 1
fi

cd "$PROJECT_DIR"

if [ -n "$(git status --porcelain)" ]; then
  echo "Deployment requires a clean Git working tree."
  exit 1
fi

REVISION="$(git rev-parse HEAD)"
UPSTREAM_REVISION="$(git rev-parse --verify '@{u}')"
if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ || "$REVISION" != "$UPSTREAM_REVISION" ]]; then
  echo "Deployment requires HEAD to equal its configured upstream revision."
  exit 1
fi

if [ -e "$PROJECT_DIR/.deployment-version.json" ]; then
  echo "Deployment metadata path already exists: $PROJECT_DIR/.deployment-version.json"
  exit 1
fi
printf '{"asset_version":"%s"}\n' "$REVISION" > "$PROJECT_DIR/.deployment-version.json"
VERSION_METADATA_CREATED=true

echo "Packaging training-web revision $REVISION..."

rm -f "$LOCAL_ARCHIVE"
tar -czf "$LOCAL_ARCHIVE" \
  --exclude=".git" \
  --exclude=".gitignore" \
  --exclude=".github" \
  --exclude=".vscode" \
  --exclude=".env" \
  --exclude=".env.*" \
  --exclude=".venv" \
  --exclude="venv" \
  --exclude="env" \
  --exclude="__pycache__" \
  --exclude="*.pyc" \
  --exclude=".DS_Store" \
  --exclude="*.db" \
  --exclude="*.sqlite" \
  --exclude="*.sqlite3" \
  --exclude="*.tar" \
  --exclude="*.tar.gz" \
  --exclude="*.zip" \
  --exclude="tmp" \
  --exclude="tests" \
  --exclude="AI_DEV_GUIDE.md" \
  --exclude="README.md" \
  --exclude="deploy_to_server_from_mac.sh" \
  --exclude="deploy_training_web.ps1" \
  .

if [ "$DRY_RUN" = true ]; then
  echo "Dry run complete. Archive contents:"
  tar -tzf "$LOCAL_ARCHIVE"
  echo "No files were uploaded or changed."
  exit 0
fi

echo "Checking HarrisServer connection..."

if ! ssh "$SERVER" "test -d '$SERVER_WEB_DIR'"; then
  echo "Server web folder not found: $SERVER_WEB_DIR"
  echo "Create it on HarrisServer before deploying."
  exit 1
fi

echo "Uploading archive..."
scp -o BatchMode=yes "$LOCAL_ARCHIVE" "$SERVER:$REMOTE_ARCHIVE"

echo "Extracting files on HarrisServer..."
ssh -o BatchMode=yes "$SERVER" \
  "set -e; tar -xzf '$REMOTE_ARCHIVE' -C '$SERVER_WEB_DIR'; rm -f '$REMOTE_ARCHIVE'; test -f '$SERVER_WEB_DIR/app.py'; echo 'Deployment complete.'"

echo ""
echo "Deployment complete."
echo ""

ssh "$SERVER" "
  echo 'Web folder:'
  ls -lah '$SERVER_WEB_DIR'
  echo
  echo 'Static folder:'
  if [ -d '$SERVER_WEB_DIR/static' ]; then
    ls -lah '$SERVER_WEB_DIR/static'
  else
    echo 'Static folder not found.'
  fi
  "