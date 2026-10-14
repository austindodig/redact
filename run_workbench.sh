#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating local Python virtual environment..."
  python3 -m venv --copies .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
  .venv/bin/python -m spacy download en_core_web_lg
fi

echo "Starting Federal Offline FOIA Redaction Workbench on http://127.0.0.1:8000 ..."
exec .venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000
