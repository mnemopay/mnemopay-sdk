# MnemoPay hosted Python client

Dependency-free Python client for the hosted MnemoPay API.

Use this when a Python agent, worker, or game service needs MnemoPay Brain,
usage, audit, and rail calls without going through MCP.

## Install

```bash
pip install mnemopay-hosted
```

For local repo usage:

```bash
pip install -e integrations/python-hosted
```

## Environment

```bash
export MNEMOPAY_API_URL="https://api.mnemopay.com"
export MNEMOPAY_API_KEY="mp_live_..."
```

`MNEMOPAY_ACCOUNT_ID` is optional. Bearer API keys resolve the account on hosted
servers; the account header is mainly useful for local development.

## Usage

```python
from mnemopay_hosted import MnemoPayHostedClient

client = MnemoPayHostedClient()

client.remember(
    "Linger uses MnemoPay to let NPCs remember player choices.",
    namespace="forge-npc:maya",
    tags=["forge", "npc"],
)

results = client.recall(
    "What should Maya remember about this player?",
    namespace="forge-npc:maya",
)

trace = client.reason(
    "What should Maya say next?",
    namespace="forge-npc:maya",
)
trace_history = client.reasoning_traces(namespace="forge-npc:maya")

graph = client.graph("forge-npc:maya")
usage = client.usage_report()
```

## Methods

- `remember(content, namespace="default", tags=None, importance=0.7)`
- `recall(query, namespace="default", limit=8, mode="hybrid")`
- `reason(query, namespace="default", limit=6, mode="hybrid")`
- `reasoning_traces(namespace=None, limit=50)`
- `reasoning_trace(trace_id)`
- `namespace(namespace="default")`
- `export_namespace(namespace="default")`
- `delete_namespace(namespace)`
- `graph(namespace="default", limit=200)`
- `enrich_graph(namespace="default")`
- `usage_report()`
- `usage_export()`
- `audit_events(limit=50)`
- `charge(amount, reason)`
- `settle(tx_id)`

## License

Apache-2.0
