"""
MnemoPay actions for Composio.

Composio supports MCP natively, so the simplest integration is pointing
Composio at the MnemoPay MCP server. This module provides an alternative:
native Composio actions that work without MCP, using the HTTP endpoint.

Usage with MCP (recommended):
    composio add mcp-mnemopay --url https://mnemopay-mcp.fly.dev/mcp

Usage with native actions:
    from composio import ComposioToolSet
    from mnemopay_composio import get_mnemopay_actions

    toolset = ComposioToolSet()
    actions = get_mnemopay_actions()
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))

from composio import Action, action


# ── Client ───────────────────────────────────────────────────────────────────

_client = None

def _get_client():
    global _client
    if _client is None:
        from mcp_client import MnemoPayClient
        _client = MnemoPayClient(
            server_url=os.environ.get("MNEMOPAY_SERVER_URL", "https://mnemopay-mcp.fly.dev"),
            agent_id=os.environ.get("MNEMOPAY_AGENT_ID", "composio-agent"),
        )
    return _client


# ── Memory Actions ───────────────────────────────────────────────────────────

@action(toolname="mnemopay", requires=[])
def remember(content: str, importance: Optional[float] = None) -> str:
    """
    Store a memory that persists across sessions.
    Use for facts, preferences, decisions, and observations.
    Importance is auto-scored from content if not provided.
    """
    args: dict[str, Any] = {"content": content}
    if importance is not None:
        args["importance"] = importance
    return _get_client().call_tool("remember", args)


@action(toolname="mnemopay", requires=[])
def recall(query: Optional[str] = None, limit: int = 5) -> str:
    """
    Recall the most relevant memories. Supports semantic search
    when a query is provided. Call before making decisions.
    """
    args: dict[str, Any] = {"limit": limit}
    if query:
        args["query"] = query
    return _get_client().call_tool("recall", args)


@action(toolname="mnemopay", requires=[])
def forget(id: str) -> str:
    """Permanently delete a memory by ID."""
    return _get_client().call_tool("forget", {"id": id})


@action(toolname="mnemopay", requires=[])
def reinforce(id: str, boost: float = 0.1) -> str:
    """Boost a memory's importance after it proved valuable."""
    return _get_client().call_tool("reinforce", {"id": id, "boost": boost})


@action(toolname="mnemopay", requires=[])
def consolidate() -> str:
    """Prune stale memories whose scores have decayed below threshold."""
    return _get_client().call_tool("consolidate", {})


# ── Payment Actions ──────────────────────────────────────────────────────────

@action(toolname="mnemopay", requires=[])
def charge(amount: float, reason: str) -> str:
    """Create an escrow charge for work delivered. Only charge AFTER delivering value."""
    return _get_client().call_tool("charge", {"amount": amount, "reason": reason})


@action(toolname="mnemopay", requires=[])
def settle(tx_id: str) -> str:
    """Finalize a pending escrow. Boosts reputation +0.01, reinforces recent memories +0.05."""
    return _get_client().call_tool("settle", {"txId": tx_id})


@action(toolname="mnemopay", requires=[])
def refund(tx_id: str) -> str:
    """Refund a transaction. Docks reputation by -0.05 if already settled."""
    return _get_client().call_tool("refund", {"txId": tx_id})


# ── Observability Actions ────────────────────────────────────────────────────

@action(toolname="mnemopay", requires=[])
def balance() -> str:
    """Check wallet balance and reputation score."""
    return _get_client().call_tool("balance", {})


@action(toolname="mnemopay", requires=[])
def profile() -> str:
    """Full agent stats: reputation, wallet, memory count, transaction count."""
    return _get_client().call_tool("profile", {})


@action(toolname="mnemopay", requires=[])
def reputation() -> str:
    """Full reputation report: score, tier, settlement rate, total value settled."""
    return _get_client().call_tool("reputation", {})


@action(toolname="mnemopay", requires=[])
def logs() -> str:
    """Immutable audit trail of all memory and payment actions."""
    return _get_client().call_tool("logs", {"limit": 20})


@action(toolname="mnemopay", requires=[])
def history() -> str:
    """Transaction history, most recent first."""
    return _get_client().call_tool("history", {"limit": 10})


# ── Convenience ──────────────────────────────────────────────────────────────

def get_mnemopay_actions() -> list:
    """Returns all 13 MnemoPay Composio actions."""
    return [
        remember, recall, forget, reinforce, consolidate,
        charge, settle, refund,
        balance, profile, reputation, logs, history,
    ]
