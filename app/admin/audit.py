"""Helpers for transactionally recording admin mutations."""
import json
from typing import Any

from aiohttp import web

from app import config
from app.models import AdminAuditLog


def add_actor_audit(
    session,
    *,
    actor: str,
    action: str,
    target_type: str | None = None,
    target_id: Any = None,
    details: dict[str, Any] | None = None,
    remote_ip: str | None = None,
    user_agent: str | None = None,
) -> AdminAuditLog:
    """Add a channel-agnostic audit row to the caller's transaction."""
    row = AdminAuditLog(
        admin_username=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        details=json.dumps(details or {}, ensure_ascii=False, sort_keys=True, default=str),
        remote_ip=remote_ip,
        user_agent=(user_agent or "")[:300] or None,
    )
    session.add(row)
    return row


def add_admin_audit(
    session,
    request: web.Request,
    action: str,
    *,
    target_type: str | None = None,
    target_id: Any = None,
    details: dict[str, Any] | None = None,
) -> AdminAuditLog:
    """Add an audit row to the caller's current database transaction."""
    return add_actor_audit(
        session,
        actor=config.ADMIN_USERNAME,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
        remote_ip=request.remote,
        user_agent=request.headers.get("User-Agent", ""),
    )
