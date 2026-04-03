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
import subprocess
import threading
from typing import Annotated, Any, Optional

from autogen_core.tools import FunctionTool


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
            agent_id=os.environ.get("MNEMOPAY_AGENT_ID", "autogen-agent"),
        )
    return _client


# ── Tool functions ───────────────────────────────────────────────────────────

def remember(
    content: Annotated[str, "What to remember"],
    importance: Annotated[Optional[float], "Importance 0-1, auto-scored if omitted"] = None,
) -> str:
    """Store a memory that persists across sessions."""
    args: dict[str, Any] = {"content": content}
    if importance is not None:
        args["importance"] = importance
    return _get_client().call_tool("remember", args)


def recall(
    query: Annotated[Optional[str], "Semantic search query"] = None,
    limit: Annotated[int, "Number of memories to recall"] = 5,
) -> str:
    """Recall relevant memories. Supports semantic search."""
    args: dict[str, Any] = {"limit": limit}
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
