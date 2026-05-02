# Weekly Sync

Incrementally pulls new DOB complaints from the NYC Open Data API, upserts them into the database, and refreshes the `building_summary` materialized view.

## What it does

1. Reads `nyc-violations/data/.last_sync` to find the last run date (defaults to 7 days ago on first run)
2. Queries the [DOB Complaints API](https://data.cityofnewyork.us/resource/eabe-havv.json) for records where `date_entered >= last_sync - 3 days` (3-day buffer for late-arriving records)
3. Cleans and normalises the records (same logic as `ingest/clean.py`)
4. Upserts into the `complaints` table — new records are inserted, existing ones have their status, disposition, and inspection fields updated
5. Refreshes `building_summary` concurrently (no read lock)
6. Writes today's date back to `.last_sync`
7. Appends a timestamped log entry to `nyc-violations/data/sync.log`

## Run manually

```bash
cd nyc-violations/ingest
source ../.venv/bin/activate
python sync.py
```

## Schedule (macOS launchd — runs every Sunday at 2 AM)

**Load:**
```bash
cp weekly_sync.plist ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
launchctl load ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
```

**Unload:**
```bash
launchctl unload ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
```

**Check status:**
```bash
launchctl list | grep nycd
```

Cron output is appended to `nyc-violations/data/sync_cron.log`.

## Schedule (cron alternative)

```bash
crontab -e
```
Add:
```
0 2 * * 0 /Users/manonaudebert/Documents/nycd/weekly_sync.sh
```

## Files

| File | Purpose |
|------|---------|
| `nyc-violations/ingest/sync.py` | Main sync script |
| `weekly_sync.sh` | Shell wrapper (activates venv, runs script) |
| `weekly_sync.plist` | macOS launchd job definition |
| `nyc-violations/data/.last_sync` | Tracks last successful run date (auto-created) |
| `nyc-violations/data/sync.log` | Rolling log of all sync runs |
| `nyc-violations/data/sync_cron.log` | stdout/stderr from scheduled runs |

## Tuning

In `ingest/sync.py`:

| Variable | Default | Description |
|----------|---------|-------------|
| `LOOKBACK_DAYS` | `3` | Extra days before last sync to re-fetch, to catch back-dated records |
| `PAGE_SIZE` | `10000` | Records per Socrata API page |
| `UPSERT_BATCH` | `5000` | Records per database batch |

## Reset (re-sync from a specific date)

To force a full re-sync from a given date, overwrite the state file:

```bash
echo "2025-01-01" > nyc-violations/data/.last_sync
python nyc-violations/ingest/sync.py
```
