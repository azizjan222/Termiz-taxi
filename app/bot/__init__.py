"""Telegram bot package for Sarix Go.

Previously the whole bot lived in a single ~900-line ``main.py`` monolith that kept
its state in in-memory dicts persisted to a JSON file (``taksi_baza.json``) IN ADDITION
to the SQL database — the same driver/balance/order was written to two places and kept
in sync by hand. That dual-storage design was fragile and hard to reason about.

This package removes that duplication:

* :mod:`app.bot.store` is the single source of truth. Every piece of bot state
  (drivers, balances, orders, history, bans, maintenance flag, ...) lives in the
  SQL database and is accessed through the :class:`~app.bot.store.BotStore` façade.
  The JSON file and the ``load_data``/``save_data`` helpers are gone.
* The handlers are split by concern into :mod:`app.bot.handlers` submodules instead
  of one giant file.
* Identifiers are in English for consistency with the rest of the backend; only the
  user-facing text stays in Uzbek (that is intentional — the users are Uzbek-speaking).
"""
