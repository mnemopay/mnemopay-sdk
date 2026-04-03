"""
MnemoPay extension for Microsoft AutoGen.

Usage:
    from autogen_agentchat.agents import AssistantAgent
    from mnemopay_autogen import mnemopay_tools

    agent = AssistantAgent(
        name="research_agent",
        tools=mnemopay_tools(),
    )
"""

from __future__ import annotations

import json
import os
import sys
from typing import Annotated, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))

from autogen_core.tools import FunctionTool

# ── Client ───────────────────────────────────────────────────────────────────

_client = None

def _get_client():
    global _client
    if _client is None:
        from mcp_client import MnemoPayClient
        _client = MnemoPayClient(
            server_url=os.environ.get("MNEMOPAY_SERVER_URL"),
            agent_id=os.environ.get("MNEMOPAY_AGENT_ID", "autogen-agent"),
        )
    return _client


# ── Tool functions ───────────────────────────────────────────────────────────

def remember(
    content: Annotated[str, "What to remember"],
    importance: Annotated[Optional[float], "Importance 0-1, auto-scored if omitted"] = None,
) -> str:
    """Store a memory that persists across sessions."""
    args = {"content": content}
    if importance is not None:
        args["importance"] = importance
    return _get_client().call_tool("remember", args)


def recall(
    query: Annotated[Optional[str], "Semantic search query"] = None,
    limit: Annotated[int, "Number of memories to recall"] = 5,
) -> str:
    """Recall relevant memories. Supports semantic search."""
    args = {"limit": limit}
    if query:
        args["query"] = query
    return _get_client().call_tool("recall", args)


def forget(id: Annotated[str, "Memory ID to delete"]) -> str:
    """Permanently delete a memory by ID."""
    return _get_client().call_tool("forget", {"id": id})


def reinforce(
    id: Annotated[str, "Memory ID"],
    boost: Annotated[float, "Importance boost 0.01-0.5"] = 0.1,
) -> str:
    """Boost a memory's importance after it proved valuable."""
    return _get_client().call_tool("reinforce", {"id": id, "boost": boost})


def consolidate() -> str:
    """Prune stale memories below decay threshold."""
    return _get_client().call_tool("consolidate", {})


def charge(
    amount: Annotated[float, "Amount in USD"],
    reason: Annotated[str, "Description of value delivered"],
) -> str:
    """Create an escrow charge for work delivered."""
    return _get_client().call_tool("charge", {"amount": amount, "reason": reason})


def settle(tx_id: Annotated[str, "Transaction ID"]) -> str:
    """Finalize a pending escrow. Boosts reputation +0.01."""
    return _get_client().call_tool("settle", {"txId": tx_id})


def refund(tx_id: Annotated[str, "Transaction ID"]) -> str:
    """Refund a transaction. Docks reputation -0.05."""
    return _get_client().call_tool("refund", {"txId": tx_id})


def balance() -> str:
    """Check wallet balance and reputation score."""
    return _get_client().call_tool("balance", {})


def profile() -> str:
    """Full agent stats: reputation, wallet, memory count, transaction count."""
    return _get_client().call_tool("profile", {})


def reputation() -> str:
    """Full reputation report: score, tier, settlement rate."""
    return _get_client().call_tool("reputation", {})


def logs() -> str:
    """Immutable audit trail of all actions."""
    return _get_client().call_tool("logs", {"limit": 20})


def history() -> str:
    """Transaction history, most recent first."""
    return _get_client().call_tool("history", {"limit": 10})


# ── Convenience ──────────────────────────────────────────────────────────────

def mnemopay_tools() -> list[FunctionTool]:
    """Returns all 13 MnemoPay tools wrapped as AutoGen FunctionTools."""
    funcs = [
        remember, recall, forget, reinforce, consolidate,
        charge, settle, refund,
        balance, profile, reputation, logs, history,
    ]
    return [FunctionTool(f, description=f.__doc__ or "") for f in funcs]
