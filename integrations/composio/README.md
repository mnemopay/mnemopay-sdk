# MnemoPay for Composio

Give any Composio-powered agent persistent memory and micropayments. Works with every framework Composio supports (CrewAI, AutoGen, LangChain, Agno, etc.).

## Fastest: Use MCP directly

Composio has native MCP support. Point it at MnemoPay's server:

```bash
composio add mcp-mnemopay --url https://mnemopay-mcp.fly.dev/mcp
```

This instantly exposes all 13 MnemoPay tools to every framework.

## Alternative: Native Actions

```bash
pip install mnemopay-composio
```

```python
from composio import ComposioToolSet
from mnemopay_composio import get_mnemopay_actions

toolset = ComposioToolSet()
actions = get_mnemopay_actions()
```

## Tools (13)

Memory: remember, recall, forget, reinforce, consolidate
Payments: charge, settle, refund
Observability: balance, profile, reputation, logs, history

## License

MIT
