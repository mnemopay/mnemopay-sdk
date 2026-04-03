# MnemoPay for Pydantic AI

Give any Pydantic AI agent persistent memory and micropayment capabilities.

## Install

```bash
pip install mnemopay-pydantic-ai
```

## Usage

```python
from pydantic_ai import Agent
from mnemopay_pydantic_ai import register_mnemopay_tools

agent = Agent("openai:gpt-4o")
register_mnemopay_tools(agent)
```

Or use MnemoPay's MCP server directly (Pydantic AI has native MCP support):

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

agent = Agent(
    "openai:gpt-4o",
    mcp_servers=[MCPServerStdio("npx", ["-y", "@mnemopay/sdk"])],
)
```

## Tools (13)

Memory: remember, recall, forget, reinforce, consolidate
Payments: charge, settle, refund
Observability: balance, profile, reputation, logs, history

## License

MIT
