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
import subprocess
import threading
from typing import Any, Optional

from agno.tools import Toolkit


# ── Embedded MCP client ─────────────────────────────────────────────────────

class _MnemoPayClient:
    def __init__(self, server_url: str | None = None, agent_id: str = "mcp-agent", mode: str = "quick"):
        self.server_url = server_url or os.environ.get("MNEMOPAY_SERVER_URL")
        self.agent_id = agent_id
        self.mode = mode
        self._process: subprocess.Popen | None = None
        self._request_id = 0
        self._lock = threading.Lock()

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        if self.server_url:
            return self._call_http(name, arguments or {})
        return self._call_stdio(name, arguments or {})

    def _call_http(self, name: str, arguments: dict[str, Any]) -> str:
        import urllib.request
        data = json.dumps({
            "jsonrpc": "2.0", "id": self._next_id(),
            "method": "tools/call", "params": {"name": name, "arguments": arguments},
        }).encode()
        req = urllib.request.Request(
            f"{self.server_url}/mcp", data=data,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode())
                if "result" in result:
                    content = result["result"].get("content", [])
                    return content[0].get("text", str(content)) if content else "OK"
                if "error" in result:
                    return f"Error: {result['error'].get('message', str(result['error']))}"
                return str(result)
        except Exception as e:
            return f"MCP error: {e}"

    def _call_stdio(self, name: str, arguments: dict[str, Any]) -> str:
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                env = {**os.environ, "MNEMOPAY_AGENT_ID": self.agent_id, "MNEMOPAY_MODE": self.mode}
                self._process = subprocess.Popen(
                    ["npx", "-y", "@mnemopay/sdk"],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                )
            assert self._process and self._process.stdin and self._process.stdout
            request = {"jsonrpc": "2.0", "id": self._next_id(), "method": "tools/call", "params": {"name": name, "arguments": arguments}}
            try:
                self._process.stdin.write(json.dumps(request).encode() + b"\n")
                self._process.stdin.flush()
                raw = self._process.stdout.readline()
                if not raw:
                    return "Error: MCP server closed"
                response = json.loads(raw.decode())
                content = response.get("result", {}).get("content", [])
                if content and isinstance(content, list):
                    return content[0].get("text", str(content))
                if "error" in response:
                    return f"Error: {response['error'].get('message', str(response['error']))}"
                return str(response.get("result", {}))
            except Exception as e:
                return f"MCP error: {e}"

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id


# ── Toolkit ──────────────────────────────────────────────────────────────────

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
        self._client: _MnemoPayClient | None = None

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
    def client(self) -> _MnemoPayClient:
        if self._client is None:
            self._client = _MnemoPayClient(
                server_url=self.server_url,
                agent_id=self.agent_id,
            )
        return self._client

    def remember(self, content: str, importance: Optional[float] = None) -> str:
        """Store a memory that persists across sessions. Use for facts, preferences, decisions."""
        args: dict[str, Any] = {"content": content}
        if importance is not None:
            args["importance"] = importance
        return self.client.call_tool("remember", args)

    def recall(self, query: Optional[str] = None, limit: int = 5) -> str:
        """Recall relevant memories. Supports semantic search with a query."""
        args: dict[str, Any] = {"limit": limit}
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
