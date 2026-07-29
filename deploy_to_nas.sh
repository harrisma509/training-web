#!/bin/bash
set -euo pipefail

PROJECT_DIR="$HOME/Code/training-web"

NAS_ROOT="/Volumes/docker/training"
NAS_WEB_DIR="$NAS_ROOT/web"

if [ ! -d "$NAS_WEB_DIR" ]; then
  echo "NAS web folder not found: $NAS_WEB_DIR"
  echo "Mount smb://192.168.1.188/docker first."
  exit 1
fi

echo "Deploying web app to NAS..."

rsync -av --delete \
  --exclude "__pycache__/" \
  --exclude "*.pyc" \
  --exclude ".DS_Store" \
* --exclude ".env" \
  --exclude ".*it/" \
  "$PROJECT_DIR/" "$NAS_WEB*DIR/"

echo "Deploy complete."

ec*o ""
echo "Web folder:"
ls -lah "$*AS_WEB_DIR"

echo ""
echo "Static *older:"
ls -lah "$NAS_WEB_DIR/stat*c"