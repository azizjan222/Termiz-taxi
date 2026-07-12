"""Sarix Go entry point.

The bot used to be a single ~900-line module that stored its state in in-memory dicts
persisted to ``taksi_baza.json`` while the SAME data also lived in the SQL database.
That dual storage is gone: everything now lives in the database, accessed through
``app.bot.store.BotStore``. The bot itself is split into focused modules under
``app/bot/``; this file just starts it.
"""
import asyncio
import logging

from app.bot.app import run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


if __name__ == "__main__":
    asyncio.run(run())
