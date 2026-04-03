"""
MnemoPay tools for OpenAI Agents SDK.

Usage:
    from agents import Agent
    from mnemopay_openai_agents import mnemopay_tools

    agent = Agent(
        name="Research Assistant",
        tools=mnemopay_tools(),
    )
"""

from __future__ import annotations

import json
import os
import sys
from typing import Optional

# Add shared client to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))

from agents import function_tool


# ── Shared MCP client ───────────────────────────────────────────────────────

_client = None

def _get_client():
    global _client
    if _client is None:
        from mcp_client import MnemoPayClient
        _client = MnemoPayClient(
            server_url=os.environ.get("MNEMOPAY_SERVER_URL"),
            agent_id=os.environ.get("MNEMOPAY_AGENT_ID", "openai-agent"),
        )
    return _client


# ── Memory Tools ─────────────────────────────────────────────────────────────

@function_tool
def remember(content: str, importance: Optional[float] = None) -> str:
    """Store a memory that persists across sessions. Use for facts, preferences, decisions."""
    args = {"content": content}
    if importance is not None:
        args["importance"] = importance
    return _get_client().call_tool("remember", args)


@function_tool
def recall(query: Optional[str] = None, limit: int = 5) -> str:
    """Recall relevant memories. Supports semantic search with a query."""
    args = {"limit": limit}
    if query:
        args["query"] = query
    return _get_client().call_tool("recall", args)


@function_tool
def forget(id: str) -> str:
    """Permanently delete a memory by ID."""
    return _get_client().call_tool("forget", {"id": id})


@function_tool
def reinforce(id: str, boost: float = 0.1) -> str:
    """Boost a memory's importance after it proved valuable."""
    return _get_client().call_tool("reinforce", {"id": id, "boost": boost})


@function_tool
def consolidate() -> str:
    """Prune stale memories whose scores have decayed below threshold."""
    return _get_client().call_tool("consolidate", {})


# ── Payment Tools ────────────────────────────────────────────────────────────

@function_tool
def charge(amount: float, reason: str) -> str:
    """Create an escrow charge for work delivered. Only charge AFTER delivering value."""
    return _get_client().call_tool("charge", {"amount": amount, "reason": reason})


@function_tool
def settle(tx_id: str) -> str:
    """Finalize a pending escrow. Boosts reputation and reinforces recent memories."""
    return _get_client().call_tool("settle", {"txId": tx_id})


@function_tool
def refund(tx_id: str) -> str:
    """Refund a transaction. Docks reputation by -0.05."""
    return _get_client().call_tool("refund", {"txId": tx_id})


# ── Observability Tools ──────────────────────────────────────────────────────

@function_tool
def balance() -> str:
    """Check wallet balance and reputation score."""
    return _get_client().call_tool("balance", {})


@function_tool
def profile() -> str:
    """Full agent stats: reputation, wallet, memory count, transaction count."""
    return _get_client().call_tool("profile", {})


@function_tool
def reputation() -> str:
    """Full reputation report: score, tier, settlement rate, total value settled."""
    return _get_client().call_tool("reputation", {})


@function_tool
def logs() -> str:
    """Immutable audit trail of all memory and payment actions."""
    return _get_client().call_tool("logs", {"limit": 20})


@function_tool
def history() -> str:
    """Transaction history, most recent first."""
    return _get_client().call_tool("history", {"limit": 10})


# ── Convenience ──────────────────────────────────────────────────────────────

def mnemopay_tools() -> list:
    """Returns all 13 MnemoPay tools for OpenAI Agents SDK."""
    return [
        remember, recall, forget, reinforce, consolidate,
        charge, settle, refund,
        balance, profile, reputation, logs, history,
    ]
