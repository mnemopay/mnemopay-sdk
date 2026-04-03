# MnemoPay for OpenAI Agents SDK

Give any OpenAI agent persistent memory and micropayment capabilities.

## Install

```bash
pip install mnemopay-openai-agents
```

## Usage

```python
from agents import Agent
from mnemopay_openai_agents import mnemopay_tools

agent = Agent(
    name="Research Assistant",
    tools=mnemopay_tools(),
)
```

## Tools (13)

Memory: remember, recall, forget, reinforce, consolidate
Payments: charge, settle, refund
Observability: balance, profile, reputation, logs, history

## License

MIT
