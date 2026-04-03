"""
MnemoPay Toolkit for Agno (formerly Phidata).

Usage:
    from agno.agent import Agent
    from mnemopay_agno import MnemoPayTools

    agent = Agent(tools=[MnemoPayTools()])
"""

from __future__ import annotations

import json
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))

from agno.tools import Toolkit


class MnemoPayTools(Toolkit):
    """MnemoPay toolkit: persistent memory + micropayments for any Agno agent."""

    def __init__(
        self,
        server_url: Optional[str] = None,
        agent_id: str = "agno-agent",
    ):
        super().__init__(name="mnemopay")
        self.server_url = server_url or os.environ.get("MNEMOPAY_SERVER_URL")
        self.agent_id = agent_id
        self._client = None

        self.register(self.remember)
        self.register(self.recall)
        self.register(self.forget)
        self.register(self.reinforce)
        self.register(self.consolidate)
        self.register(self.charge)
        self.register(self.settle)
        self.register(self.refund)
        self.register(self.balance)
        self.register(self.profile)
        self.register(self.reputation)
        self.register(self.logs)
        self.register(self.history)

    @property
    def client(self):
        if self._client is None:
            from mcp_client import MnemoPayClient
            self._client = MnemoPayClient(
                server_url=self.server_url,
                agent_id=self.agent_id,
            )
        return self._client

    def remember(self, content: str, importance: Optional[float] = None) -> str:
        """Store a memory that persists across sessions. Use for facts, preferences, decisions."""
        args = {"content": content}
        if importance is not None:
            args["importance"] = importance
        return self.client.call_tool("remember", args)

    def recall(self, query: Optional[str] = None, limit: int = 5) -> str:
        """Recall relevant memories. Supports semantic search with a query."""
        args = {"limit": limit}
        if query:
            args["query"] = query
        return self.client.call_tool("recall", args)

    def forget(self, id: str) -> str:
        """Permanently delete a memory by ID."""
        return self.client.call_tool("forget", {"id": id})

    def reinforce(self, id: str, boost: float = 0.1) -> str:
        """Boost a memory's importance after it proved valuable."""
        return self.client.call_tool("reinforce", {"id": id, "boost": boost})

    def consolidate(self) -> str:
        """Prune stale memories whose scores have decayed below threshold."""
        return self.client.call_tool("consolidate", {})

    def charge(self, amount: float, reason: str) -> str:
        """Create an escrow charge for work delivered. Only charge AFTER delivering value."""
        return self.client.call_tool("charge", {"amount": amount, "reason": reason})

    def settle(self, tx_id: str) -> str:
        """Finalize a pending escrow. Boosts reputation and reinforces recent memories."""
        return self.client.call_tool("settle", {"txId": tx_id})

    def refund(self, tx_id: str) -> str:
        """Refund a transaction. Docks reputation by -0.05."""
        return self.client.call_tool("refund", {"txId": tx_id})

    def balance(self) -> str:
        """Check wallet balance and reputation score."""
        return self.client.call_tool("balance", {})

    def profile(self) -> str:
        """Full agent stats: reputation, wallet, memory count, transaction count."""
        return self.client.call_tool("profile", {})

    def reputation(self) -> str:
        """Full reputation report: score, tier, settlement rate, total value settled."""
        return self.client.call_tool("reputation", {})

    def logs(self, limit: int = 20) -> str:
        """Immutable audit trail of all memory and payment actions."""
        return self.client.call_tool("logs", {"limit": limit})

    def history(self, limit: int = 10) -> str:
        """Transaction history, most recent first."""
        return self.client.call_tool("history", {"limit": limit})
