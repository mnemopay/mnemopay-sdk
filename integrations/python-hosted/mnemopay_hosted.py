"""
Small Python client for the hosted MnemoPay API.

This client talks to the dashboard/server `/api/v1` surface directly. It is
intentionally dependency-free so agent frameworks can vendor or wrap it without
pulling in a larger SDK.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class MnemoPayAPIError(RuntimeError):
    """Raised when the hosted MnemoPay API returns an error response."""

    def __init__(self, status: int, payload: Any):
        self.status = status
        self.payload = payload
        message = payload.get("error") if isinstance(payload, dict) else str(payload)
        super().__init__(f"MnemoPay API error {status}: {message}")


@dataclass(slots=True)
class MnemoPayHostedClient:
    """Client for MnemoPay hosted Brain, usage, audit, and rail endpoints."""

    base_url: str | None = None
    api_key: str | None = None
    account_id: str | None = None
    timeout: int = 30

    def __post_init__(self) -> None:
        self.base_url = (self.base_url or os.environ.get("MNEMOPAY_API_URL") or "http://localhost:8787").rstrip("/")
        self.api_key = self.api_key or os.environ.get("MNEMOPAY_API_KEY")
        self.account_id = self.account_id or os.environ.get("MNEMOPAY_ACCOUNT_ID")

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        if query:
            clean_query = {k: v for k, v in query.items() if v is not None}
            url = f"{url}?{urllib.parse.urlencode(clean_query)}"

        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.account_id:
            headers["X-MnemoPay-Account"] = self.account_id

        req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {"ok": True}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            try:
                payload: Any = json.loads(raw) if raw else {"error": exc.reason}
            except json.JSONDecodeError:
                payload = {"error": raw or exc.reason}
            raise MnemoPayAPIError(exc.code, payload) from exc

    # Brain

    def remember(
        self,
        content: str,
        namespace: str = "default",
        tags: list[str] | None = None,
        importance: float = 0.7,
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v1/brain/memories",
            {
                "namespace": namespace,
                "content": content,
                "tags": tags or [],
                "importance": importance,
            },
        )

    def recall(
        self,
        query: str,
        namespace: str = "default",
        limit: int = 8,
        mode: str = "hybrid",
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v1/brain/query",
            {
                "namespace": namespace,
                "query": query,
                "limit": limit,
                "mode": mode,
            },
        )

    def reason(
        self,
        query: str,
        namespace: str = "default",
        limit: int = 6,
        mode: str = "hybrid",
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v1/brain/reason",
            {
                "namespace": namespace,
                "query": query,
                "limit": limit,
                "mode": mode,
            },
        )

    def reasoning_traces(self, namespace: str | None = None, limit: int = 50) -> dict[str, Any]:
        return self.request(
            "GET",
            "/api/v1/brain/reason/traces",
            query={"namespace": namespace, "limit": limit},
        )

    def reasoning_trace(self, trace_id: str) -> dict[str, Any]:
        encoded = urllib.parse.quote(trace_id, safe="")
        return self.request("GET", f"/api/v1/brain/reason/traces/{encoded}")

    def namespace(self, namespace: str = "default") -> dict[str, Any]:
        return self.request("GET", f"/api/v1/brain/namespaces/{urllib.parse.quote(namespace, safe='')}")

    def export_namespace(self, namespace: str = "default") -> dict[str, Any]:
        encoded = urllib.parse.quote(namespace, safe="")
        return self.request("GET", f"/api/v1/brain/namespaces/{encoded}/export")

    def delete_namespace(self, namespace: str) -> dict[str, Any]:
        return self.request("DELETE", f"/api/v1/brain/namespaces/{urllib.parse.quote(namespace, safe='')}")

    def graph(self, namespace: str = "default", limit: int = 200) -> dict[str, Any]:
        encoded = urllib.parse.quote(namespace, safe="")
        return self.request("GET", f"/api/v1/brain/namespaces/{encoded}/graph", query={"limit": limit})

    def enrich_graph(self, namespace: str = "default") -> dict[str, Any]:
        encoded = urllib.parse.quote(namespace, safe="")
        return self.request("POST", f"/api/v1/brain/namespaces/{encoded}/enrich", {})

    # Usage and audit

    def usage_report(self) -> dict[str, Any]:
        return self.request("GET", "/api/v1/usage/report")

    def usage_export(self) -> dict[str, Any]:
        return self.request("GET", "/api/v1/usage/export")

    def audit_events(self, limit: int = 50) -> dict[str, Any]:
        return self.request("GET", "/api/v1/audit/events", query={"limit": limit})

    # Current dashboard rail endpoints are still legacy `/api/*`.

    def charge(self, amount: float, reason: str) -> dict[str, Any]:
        return self.request("POST", "/api/charge", {"amount": amount, "reason": reason})

    def settle(self, tx_id: str) -> dict[str, Any]:
        return self.request("POST", "/api/settle", {"txId": tx_id})


__all__ = ["MnemoPayAPIError", "MnemoPayHostedClient"]
