from __future__ import annotations

import json
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from mnemopay_hosted import MnemoPayHostedClient


class MnemoPayHostedClientTest(unittest.TestCase):
    def test_remember_posts_to_hosted_brain_with_bearer_auth(self) -> None:
        client = MnemoPayHostedClient(
            base_url="https://api.example.test",
            api_key="mp_test_secret",
            account_id="acct_test",
        )
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"id":"mem_1"}'

        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            payload = client.remember("Sonova hired BizSuite.", namespace="sales", tags=["deal"])

        self.assertEqual(payload["id"], "mem_1")
        req = urlopen.call_args.args[0]
        self.assertEqual(req.full_url, "https://api.example.test/api/v1/brain/memories")
        self.assertEqual(req.headers["Authorization"], "Bearer mp_test_secret")
        self.assertEqual(req.headers["X-mnemopay-account"], "acct_test")
        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["namespace"], "sales")
        self.assertEqual(body["tags"], ["deal"])

    def test_graph_encodes_namespace_and_limit(self) -> None:
        client = MnemoPayHostedClient(base_url="http://localhost:8787")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"entities":[],"edges":[]}'

        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            client.graph("forge npc:maya", limit=12)

        req = urlopen.call_args.args[0]
        self.assertEqual(
            req.full_url,
            "http://localhost:8787/api/v1/brain/namespaces/forge%20npc%3Amaya/graph?limit=12",
        )

    def test_reason_posts_to_brain_reason_endpoint(self) -> None:
        client = MnemoPayHostedClient(base_url="http://localhost:8787")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"answer":"ok","confidence":0.8}'

        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            payload = client.reason("What matters?", namespace="agent:one")

        self.assertEqual(payload["confidence"], 0.8)
        req = urlopen.call_args.args[0]
        self.assertEqual(req.full_url, "http://localhost:8787/api/v1/brain/reason")
        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["namespace"], "agent:one")
        self.assertEqual(body["mode"], "hybrid")

    def test_reasoning_traces_lists_and_fetches_trace(self) -> None:
        client = MnemoPayHostedClient(base_url="http://localhost:8787")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"traces":[]}'

        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            client.reasoning_traces(namespace="agent:one", limit=10)

        req = urlopen.call_args.args[0]
        self.assertEqual(
            req.full_url,
            "http://localhost:8787/api/v1/brain/reason/traces?namespace=agent%3Aone&limit=10",
        )

        detail_response = MagicMock()
        detail_response.__enter__.return_value.read.return_value = b'{"ok":true,"trace":{"id":"trace_1"}}'
        with patch("urllib.request.urlopen", return_value=detail_response) as detail_urlopen:
            payload = client.reasoning_trace("trace_1")

        self.assertEqual(payload["trace"]["id"], "trace_1")
        detail_req = detail_urlopen.call_args.args[0]
        self.assertEqual(detail_req.full_url, "http://localhost:8787/api/v1/brain/reason/traces/trace_1")


if __name__ == "__main__":
    unittest.main()
