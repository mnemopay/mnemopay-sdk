"""
MnemoPay tools for Pydantic AI.

Usage:
    from pydantic_ai import Agent
    from mnemopay_pydantic_ai import register_mnemopay_tools

    agent = Agent("openai:gpt-4o")
    register_mnemopay_tools(agent)
"""

from __future__ import annotations

import os
import sys
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))

from pydantic_ai import Agent, RunContext


# ── Client ───────────────────────────────────────────────────────────────────

_client = None

def _get_client():
    global _client
    if _client is None:
        from mcp_client import MnemoPayClient
        _client = MnemoPayClient(
            server_url=os.environ.get("MNEMOPAY_SERVER_URL"),
            agent_id=os.environ.get("MNEMOPAY_AGENT_ID", "pydantic-agent"),
        )
    return _client


# ── Registration ─────────────────────────────────────────────────────────────

def register_mnemopay_tools(agent: Agent) -> None:
    """Register all 13 MnemoPay tools on a Pydantic AI agent."""

    @agent.tool_plain
    def remember(content: str, importance: Optional[float] = None) -> str:
        """Store a memory that persists across sessions. Use for facts, preferences, decisions."""
        args = {"content": content}
        if importance is not None:
            args["importance"] = importance
        return _get_client().call_tool("remember", args)

    @agent.tool_plain
    def recall(query: Optional[str] = None, limit: int = 5) -> str:
        """Recall relevant memories. Supports semantic search with a query."""
        args = {"limit": limit}
        if query:
            args["query"] = query
        return _get_client().call_tool("recall", args)

    @agent.tool_plain
    def forget(id: str) -> str:
        """Permanently delete a memory by ID."""
        return _get_client().call_tool("forget", {"id": id})

    @agent.tool_plain
    def reinforce(id: str, boost: float = 0.1) -> str:
        """Boost a memory's importance after it proved valuable."""
        return _get_client().call_tool("reinforce", {"id": id, "boost": boost})

    @agent.tool_plain
    def consolidate() -> str:
        """Prune stale memories whose scores have decayed below threshold."""
        return _get_client().call_tool("consolidate", {})

    @agent.tool_plain
    def charge(amount: float, reason: str) -> str:
        """Create an escrow charge for work delivered. Only charge AFTER delivering value."""
        return _get_client().call_tool("charge", {"amount": amount, "reason": reason})

    @agent.tool_plain
    def settle(tx_id: str) -> str:
        """Finalize a pending escrow. Boosts reputation and reinforces recent memories."""
        return _get_client().call_tool("settle", {"txId": tx_id})

    @agent.tool_plain
    def refund(tx_id: str) -> str:
        """Refund a transaction. Docks reputation by -0.05."""
        return _get_client().call_tool("refund", {"txId": tx_id})

    @agent.tool_plain
    def balance() -> str:
        """Check wallet balance and reputation score."""
        return _get_client().call_tool("balance", {})

    @agent.tool_plain
    def profile() -> str:
        """Full agent stats: reputation, wallet, memory count, transaction count."""
        return _get_client().call_tool("profile", {})

    @agent.tool_plain
    def reputation() -> str:
        """Full reputation report: score, tier, settlement rate, total value settled."""
        return _get_client().call_tool("reputation", {})

    @agent.tool_plain
    def logs() -> str:
        """Immutable audit trail of all memory and payment actions."""
        return _get_client().call_tool("logs", {"limit": 20})

    @agent.tool_plain
    def history() -> str:
        """Transaction history, most recent first."""
        return _get_client().call_tool("history", {"limit": 10})
