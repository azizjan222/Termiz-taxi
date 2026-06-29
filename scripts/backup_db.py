#!/usr/bin/env python3
"""Database backup utility for Sarix Go.

Creates a timestamped, gzipped backup of the configured database and (optionally) prunes
old backups, keeping only the newest N. Works for BOTH engines the app supports:

  * SQLite   -> uses the online backup API (``sqlite3`` ``.backup``) so it is safe even
                while the app is running, then gzips the snapshot.
  * Postgres -> runs ``pg_dump`` (must be on PATH) and gzips the SQL dump.

It reads ``DATABASE_URL`` from the environment exactly like the app does (including the
legacy ``postgres://`` -> ``postgresql://`` fix and the persistent-volume sqlite default),
so it always targets the live database.

Usage:
    python scripts/backup_db.py                      # -> ./backups (or $BACKUP_DIR)
    python scripts/backup_db.py --keep 14            # keep only the 14 newest backups
    BACKUP_DIR=/data/backups python scripts/backup_db.py
    python scripts/backup_db.py --out /data/backups --keep 30

Exit code 0 on success, non-zero on failure. No third-party dependencies (stdlib only;
Postgres mode additionally needs the ``pg_dump`` binary).
"""
import argparse
import gzip
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

BACKUP_PREFIX = "sarixgo-"


def resolve_database_url() -> str:
    """Resolve DATABASE_URL the same way the app does (stdlib-only, standalone)."""
    raw = os.getenv("DATABASE_URL", "").strip()
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    if raw and not raw.startswith("sqlite"):
        return raw
    if raw.startswith("sqlite"):
        return raw
    data_dir = os.getenv("DATA_DIR", "/data")
    if os.path.isdir(data_dir):
        return f"sqlite:////{data_dir.strip('/')}/sarixgo.db"
    return "sqlite:///./data/sarixgo.db"


def _sqlite_file(url: str) -> str:
    """Extract the filesystem path from a sqlite:// URL."""
    return url.split("sqlite:///")[-1]


def backup_sqlite(url: str, out_path: Path) -> None:
    """Snapshot a SQLite DB via the online backup API, then gzip it."""
    db_file = _sqlite_file(url)
    if not os.path.exists(db_file):
        raise FileNotFoundError(f"SQLite DB not found: {db_file}")

    # Online backup to a temp .db (consistent even if the app is writing concurrently).
    tmp_fd, tmp_name = tempfile.mkstemp(suffix=".db")
    os.close(tmp_fd)
    try:
        src = sqlite3.connect(db_file)
        dst = sqlite3.connect(tmp_name)
        try:
            with dst:
                src.backup(dst)
        finally:
            dst.close()
            src.close()

        with open(tmp_name, "rb") as f_in, gzip.open(out_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
    finally:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)


def backup_postgres(url: str, out_path: Path) -> None:
    """Dump a Postgres DB with pg_dump and gzip the output (streamed)."""
    if shutil.which("pg_dump") is None:
        raise RuntimeError("pg_dump not found on PATH (install postgresql-client)")

    cmd = ["pg_dump", "--no-owner", "--no-privileges", url]
    with gzip.open(out_path, "wb") as f_out:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert proc.stdout is not None
        shutil.copyfileobj(proc.stdout, f_out)
        _, stderr = proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"pg_dump failed (code {proc.returncode}): {stderr.decode(errors='replace')[:500]}"
            )


def prune_old_backups(backup_dir: Path, keep: int) -> int:
    """Keep only the newest `keep` backups; delete the rest. Returns count removed."""
    if keep <= 0:
        return 0
    backups = sorted(
        backup_dir.glob(f"{BACKUP_PREFIX}*.gz"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    removed = 0
    for old in backups[keep:]:
        try:
            old.unlink()
            removed += 1
        except OSError:
            pass
    return removed


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Backup the Sarix Go database.")
    parser.add_argument(
        "--out",
        default=os.getenv("BACKUP_DIR", "./backups"),
        help="Directory to write backups into (default: ./backups or $BACKUP_DIR).",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=int(os.getenv("BACKUP_KEEP", "14")),
        help="How many newest backups to keep (0 = keep all). Default: 14.",
    )
    args = parser.parse_args(argv)

    url = resolve_database_url()
    backup_dir = Path(args.out)
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    is_sqlite = url.startswith("sqlite")
    ext = "db.gz" if is_sqlite else "sql.gz"
    out_path = backup_dir / f"{BACKUP_PREFIX}{ts}.{ext}"

    engine = "SQLite" if is_sqlite else "Postgres"
    print(f"[backup] engine={engine} -> {out_path}")
    try:
        if is_sqlite:
            backup_sqlite(url, out_path)
        else:
            backup_postgres(url, out_path)
    except Exception as e:
        print(f"[backup] FAILED: {e}", file=sys.stderr)
        # Don't leave a half-written file behind.
        if out_path.exists():
            out_path.unlink()
        return 1

    size_kb = out_path.stat().st_size / 1024
    print(f"[backup] OK: {out_path.name} ({size_kb:.1f} KB)")

    removed = prune_old_backups(backup_dir, args.keep)
    if removed:
        print(f"[backup] pruned {removed} old backup(s), keeping newest {args.keep}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
