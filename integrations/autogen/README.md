# MnemoPay for Microsoft AutoGen

Give any AutoGen agent persistent memory and micropayment capabilities.

## Install

```bash
pip install mnemopay-autogen
```

## Usage

```python
from autogen_agentchat.agents import AssistantAgent
from mnemopay_autogen import mnemopay_tools

agent = AssistantAgent(
    name="research_agent",
    tools=mnemopay_tools(),
)
```

## Tools (13)

Memory: remember, recall, forget, reinforce, consolidate
Payments: charge, settle, refund
Observability: balance, profile, reputation, logs, history

## License

MIT
