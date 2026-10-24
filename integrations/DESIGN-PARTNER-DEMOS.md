# MnemoPay design-partner demos

These are the four supported demo paths used during a 30-minute design-partner
session. Each demo ends by exporting or inspecting the governed agent's audit
record.

## OpenAI Agents SDK

Use `integrations/openai-agents/`. The adapter exposes MnemoPay memory,
payments and observability as OpenAI function tools.

## Claude / Anthropic

Run `examples/03-anthropic-middleware.ts`. The middleware preserves memory
between conversations and records the model interaction in the agent context.

## CrewAI

Use `integrations/crewai/`. The adapter exposes the MnemoPay MCP tool set to
each CrewAI agent.

## LangChain / LangGraph

Use `integrations/langchain/`. It exports `mnemoTools()` and
`agentPayTools()` for `createReactAgent`.

## Audit close

Run `node examples/09-sample-article12-bundle.mjs` after `npm run build`.
The generated `sample-article12-bundle/` directory contains the regulator-
readable mission, events, CSV, chain and manifest files.
