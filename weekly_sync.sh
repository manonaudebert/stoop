#!/usr/bin/env bash
# Run the incremental DOB complaints sync.
#
# ── macOS scheduling (launchd) ───────────────────────────────────────────────
# 1. Copy weekly_sync.plist to ~/Library/LaunchAgents/
# 2. Load it:
#      launchctl load ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
# 3. To unload:
#      launchctl unload ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
#
# ── cron alternative ─────────────────────────────────────────────────────────
# Add to crontab (run every Sunday at 2 AM):
#   crontab -e
#   0 2 * * 0 /path/to/stoop/weekly_sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INGEST_DIR="$SCRIPT_DIR/ingest"
DATA_DIR="$SCRIPT_DIR/data"
VENV="$SCRIPT_DIR/.venv/bin/activate"

mkdir -p "$DATA_DIR"

echo "=== $(date '+%Y-%m-%d %H:%M:%S')  Starting weekly sync ==="

if [[ -f "$VENV" ]]; then
    # shellcheck disable=SC1090
    source "$VENV"
fi

cd "$INGEST_DIR"
python sync_all.py

echo "=== $(date '+%Y-%m-%d %H:%M:%S')  Sync complete ==="
