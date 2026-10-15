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

# Free port 8000 if a previous server instance is still running
EXISTING_PIDS=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$EXISTING_PIDS" ]; then
  echo "Stopping existing process on port 8000 (PID: $EXISTING_PIDS)..."
  kill -9 $EXISTING_PIDS 2>/dev/null || true
  sleep 0.5
fi

echo "Starting Document Redactor on http://127.0.0.1:8000 ..."
exec .venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
