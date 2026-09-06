#!/bin/bash
set -euo pipefail

PROJECT_DIR="$HOME/Code/training-web"
SERVER="harrisserver"
SERVER_WEB_DIR="/opt/training/web"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Local project folder not found: $PROJECT_DIR"
  exit 1
fi

echo "Checking HarrisServer connection..."

if ! ssh "$SERVER" "test -d '$SERVER_WEB_DIR'"; then
  echo "Server web folder not found: $SERVER_WEB_DIR"
  echo "Create it on HarrisServer before deploying."
  exit 1
fi

echo "Deploying training-web to HarrisServer..."

rsync -av --delete \
  --exclude "__pycache__/" \
  --exclude "*.pyc" \
  --exclude ".DS_Store" \
  --exclude ".env" \
  --exclude ".git/" \
  --exclude ".venv/" \
  --exclude "venv/" \
  --exclude "env/" \
  --exclude "deploy_to_nas.sh" \
  --exclude "deploy_to_server.sh" \
  "$PROJECT_DIR/" "$SERVER:$SERVER_WEB_DIR/"

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