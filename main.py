"""Sarix Go entry point.

The bot used to be a single ~900-line module that stored its state in in-memory dicts
persisted to ``taksi_baza.json`` while the SAME data also lived in the SQL database.
That dual storage is gone: everything now lives in the database, accessed through
``app.bot.store.BotStore``. The bot itself is split into focused modules under
``app/bot/``; this file just starts it.
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


def _has_valid_bot_token() -> bool:
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token or token == "your_bot_token_here":
        return False
    parts = token.split(":", 1)
    return len(parts) == 2 and parts[0].isdigit() and len(parts[1]) >= 10


if __name__ == "__main__":
    preview_script = Path(__file__).resolve().parent / "preview-server.mjs"
    if not _has_valid_bot_token() and preview_script.is_file():
        os.environ.setdefault("PORT", "3000")
        os.execvp("node", ["node", str(preview_script)])

    from app.bot.app import run

    asyncio.run(run())

