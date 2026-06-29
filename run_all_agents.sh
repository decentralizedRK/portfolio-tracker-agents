#!/usr/bin/env bash
# Runs every portfolio agent and syncs output to docs/data/.
# Usage: ./run_all_agents.sh
# Called automatically by the pre-push git hook.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$REPO_ROOT/agents"

VENV_PYTHON="$REPO_ROOT/.venv/bin/python3"
PYTHON="${VENV_PYTHON}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

run_agent() {
  local script="$1"; shift
  echo "  → $script"
  cd "$AGENTS_DIR"
  PYTHONPATH="$REPO_ROOT" "$PYTHON" "$script" "$@" || {
    echo "  ⚠️  $script failed — continuing"
  }
  cd "$REPO_ROOT"
}

echo "🤖 Running all agents…"
run_agent portfolio_update_agent.py --force
run_agent fno_recommendation_agent.py
run_agent news_agent.py
run_agent recommendation_agent.py
run_agent corporate_action_agent.py
run_agent mf_update_agent.py

echo "🔄 Syncing data/ → docs/data/…"
cp "$REPO_ROOT/data/"*.json "$REPO_ROOT/docs/data/"

echo "✅ All agents done."
