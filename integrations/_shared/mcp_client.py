"""
Shared MnemoPay MCP client for all Python integrations.

Supports two modes:
1. HTTP/SSE — connects to a remote MnemoPay server (e.g. https://mnemopay-mcp.fly.dev)
2. Stdio — spawns a local MnemoPay MCP server via `npx @mnemopay/sdk`

All Python integrations (Composio, AutoGen, Agno, Pydantic AI, CrewAI, Hermes)
import this shared client rather than duplicating the MCP communication logic.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from typing import Any, Optional


class MnemoPayClient:
    """Lightweight MCP client for MnemoPay."""

    def __init__(
        self,
        server_url: Optional[str] = None,
        agent_id: str = "mcp-agent",
        mode: str = "quick",
    ):
        self.server_url = server_url or os.environ.get("MNEMOPAY_SERVER_URL")
        self.agent_id = agent_id
        self.mode = mode
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 0
        self._lock = threading.Lock()

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        """Call an MCP tool and return the text result."""
        if self.server_url:
            return self._call_http(name, arguments or {})
        return self._call_stdio(name, arguments or {})

    # ── HTTP/SSE mode ────────────────────────────────────────────────────────

    def _call_http(self, name: str, arguments: dict[str, Any]) -> str:
        import urllib.request

        # Establish SSE session
        try:
            sse_req = urllib.request.Request(
                f"{self.server_url}/mcp",
                headers={"Accept": "text/event-stream"},
            )
            with urllib.request.urlopen(sse_req, timeout=10) as sse_resp:
                # Read until we get the endpoint event
                data = b""
                while True:
                    chunk = sse_resp.read(1)
                    if not chunk:
                        break
                    data += chunk
                    if b"\n\n" in data:
                        break

                text = data.decode()
                import re
                match = re.search(r"data:\s*(\S+)", text)
                if not match:
                    return "Error: Could not establish SSE session"

                messages_url = f"{self.server_url}{match.group(1)}"

            # POST the tool call
            request_body = json.dumps({
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }).encode()

            req = urllib.request.Request(
                messages_url,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                # Response comes via SSE stream, but the POST returns 200 OK
                pass

            # Read result from SSE stream — reconnect to get it
            # For simplicity, use a direct POST approach
            return self._call_http_simple(name, arguments)

        except Exception as e:
            return f"MCP error: {e}"

    def _call_http_simple(self, name: str, arguments: dict[str, Any]) -> str:
        """Simple HTTP POST for tool calls (works with streamable HTTP transport)."""
        import urllib.request

        data = json.dumps({
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }).encode()

        req = urllib.request.Request(
            f"{self.server_url}/mcp",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
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

    # ── Stdio mode ───────────────────────────────────────────────────────────

    def _ensure_started(self) -> None:
        if self._process is not None and self._process.poll() is None:
            return
        env = {
            **os.environ,
            "MNEMOPAY_AGENT_ID": self.agent_id,
            "MNEMOPAY_MODE": self.mode,
        }
        self._process = subprocess.Popen(
            ["npx", "-y", "@mnemopay/sdk"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

    def _call_stdio(self, name: str, arguments: dict[str, Any]) -> str:
        with self._lock:
            self._ensure_started()
            assert self._process and self._process.stdin and self._process.stdout

            request = {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }
            try:
                self._process.stdin.write(json.dumps(request).encode() + b"\n")
                self._process.stdin.flush()
                raw = self._process.stdout.readline()
                if not raw:
                    return "Error: MCP server closed"
                response = json.loads(raw.decode())
                result = response.get("result", {})
                content = result.get("content", [])
                if content and isinstance(content, list):
                    return content[0].get("text", str(content))
                if "error" in response:
                    return f"Error: {response['error'].get('message', str(response['error']))}"
                return str(result)
            except Exception as e:
                return f"MCP error: {e}"

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def shutdown(self) -> None:
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()

    # ── Convenience methods ──────────────────────────────────────────────────

    def remember(self, content: str, importance: float | None = None, tags: list[str] | None = None) -> str:
        args: dict[str, Any] = {"content": content}
        if importance is not None:
            args["importance"] = importance
        if tags:
            args["tags"] = tags
        return self.call_tool("remember", args)

    def recall(self, query: str | None = None, limit: int = 5) -> str:
        args: dict[str, Any] = {"limit": limit}
        if query:
            args["query"] = query
        return self.call_tool("recall", args)

    def forget(self, memory_id: str) -> str:
        return self.call_tool("forget", {"id": memory_id})

    def reinforce(self, memory_id: str, boost: float = 0.1) -> str:
        return self.call_tool("reinforce", {"id": memory_id, "boost": boost})

    def consolidate(self) -> str:
        return self.call_tool("consolidate")

    def charge(self, amount: float, reason: str) -> str:
        return self.call_tool("charge", {"amount": amount, "reason": reason})

    def settle(self, tx_id: str) -> str:
        return self.call_tool("settle", {"txId": tx_id})

    def refund(self, tx_id: str) -> str:
        return self.call_tool("refund", {"txId": tx_id})

    def balance(self) -> str:
        return self.call_tool("balance")

    def profile(self) -> str:
        return self.call_tool("profile")

    def reputation(self) -> str:
        return self.call_tool("reputation")

    def logs(self, limit: int = 20) -> str:
        return self.call_tool("logs", {"limit": limit})

    def history(self, limit: int = 10) -> str:
        return self.call_tool("history", {"limit": limit})
