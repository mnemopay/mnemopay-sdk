# MnemoPay for Agno

Give any Agno agent persistent memory and micropayment capabilities.

## Install

```bash
pip install mnemopay-agno
```

## Usage

```python
from agno.agent import Agent
from mnemopay_agno import MnemoPayTools

agent = Agent(tools=[MnemoPayTools()])
```

## Tools (13)

Memory: remember, recall, forget, reinforce, consolidate
Payments: charge, settle, refund
Observability: balance, profile, reputation, logs, history

## License

MIT
