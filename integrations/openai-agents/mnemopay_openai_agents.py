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
import subprocess
import threading
from typing import Any, Optional

from agents import function_tool


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


# ── Client singleton ────────────────────────────────────────────────────────

_client: _MnemoPayClient | None = None

def _get_client() -> _MnemoPayClient:
    global _client
    if _client is None:
        _client = _MnemoPayClient(
            server_url=os.environ.get("MNEMOPAY_SERVER_URL"),
            agent_id=os.environ.get("MNEMOPAY_AGENT_ID", "openai-agent"),
        )
    return _client


# ── Memory Tools ─────────────────────────────────────────────────────────────

@function_tool
def remember(content: str, importance: Optional[float] = None) -> str:
    """Store a memory that persists across sessions. Use for facts, preferences, decisions."""
    args: dict[str, Any] = {"content": content}
    if importance is not None:
        args["importance"] = importance
    return _get_client().call_tool("remember", args)


@function_tool
def recall(query: Optional[str] = None, limit: int = 5) -> str:
    """Recall relevant memories. Supports semantic search with a query."""
    args: dict[str, Any] = {"limit": limit}
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
