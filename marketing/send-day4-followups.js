// Day-4 Follow-Up Email Sender — 2026-04-15
// Sends 14 overdue follow-up emails via Maileroo SMTP API
// From: jeremiah@getbizsuite.com (NEVER jerry@)

const MAILEROO_API_KEY = process.env.MAILEROO_API_KEY || "cc623477e89776ea6b61d955942aa9567e4a35ee45b9ca6836e2e86f0bb84d95";
const FROM = "Jerry Omiagbo <jeremiah@getbizsuite.com>";

const emails = [
  {
    to: "info@mockloop.com",
    subject: "Re: per-call billing for MockLoop MCP",
    text: `hey — figured that might've gotten buried last week.

the tldr: npm i @mnemopay/sdk, 2 lines in your tool handler, and MockLoop can charge per-call on every mock generation. agents auto-settle via Lightning. no Stripe integration, no KYB paperwork.

for a commercial MCP server like yours the math is straightforward — 100K calls at $0.002 = $200/mo you'd otherwise eat or gate behind a clunky API key system.

repo: github.com/mnemopay/mnemopay-sdk
if not a fit, genuinely no worries. just didn't want to ghost on you.

Jerry`
  },
  {
    to: "raveen.b@gmail.com",
    subject: "Re: monetizing fal-mcp-server calls",
    text: `hey Raveen — bumping this in case last week's note got lost.

short version: you're already paying fal per-call upstream. mnemopay lets you pass that cost through to the agent calling your MCP server — down to 0.1 cent resolution. 2 lines in the tool handler, agents settle automatically via Lightning.

you've built 3 companies so you know the billing plumbing pain. this is the plumbing, pre-built.

npm: @mnemopay/sdk
github: github.com/mnemopay/mnemopay-sdk

if the timing's off, no stress. just didn't want to disappear.

Jerry`
  },
  // lisa@tastehub.io REMOVED — already emailed 2026-04-15, don't double-send
  {
    to: "wes.mcclure@gmail.com",
    subject: "Re: gating runProcess on mcp-server-commands",
    text: `Wes — circling back on last week's note.

your runProcess tool is powerful but also the kind of thing that gets abused at scale. mnemopay adds an agent credit score (300-850, like FICO) that gates tool access automatically — low-trust agents get blocked before they can run expensive or risky commands.

it's not just billing, it's safety. and it drops in with 2 lines.

npm i @mnemopay/sdk
github.com/mnemopay/mnemopay-sdk

happy to walk through the trust-scoring piece if that's more interesting than the billing side. or if it's not a fit, no hard feelings.

Jerry`
  },
  {
    to: "contact@julienc.me",
    subject: "Re: metering across anyquery's 40 connectors",
    text: `hey Julien — following up from last week.

with 40+ connectors in anyquery, the cost surface is massive — some queries are cheap, some hit paid APIs. mnemopay lets you meter per-call at the tool level so agents pay proportionally. sub-cent resolution, Lightning settlement, no Stripe integration needed.

the agent FICO score also means you can auto-block abusive callers before they hammer your expensive connectors.

github.com/mnemopay/mnemopay-sdk

still have free-forever design partner slots open. if anyquery isn't ready for this yet, totally fine — just keeping the thread warm.

Jerry`
  },
  {
    to: "ggozadinos@gmail.com",
    subject: "Re: per-ingest billing for haiku.rag",
    text: `hey — following up on last week's note about haiku.rag.

RAG ingestion is expensive — embeddings, chunking, storage. right now every agent calling your MCP server gets that for free. mnemopay lets you charge per-ingest or per-query, sub-cent, auto-settled. 2 lines in your tool handler.

the agent FICO score also means you can rate-limit low-trust agents before they dump garbage into your index.

github.com/mnemopay/mnemopay-sdk

no pressure either way. just didn't want to leave you hanging.

Jerry`
  },
  {
    to: "pavel@cloudefined.com",
    subject: "Re: cost-gating PromQL on prometheus-mcp",
    text: `Pavel — quick bump from last week.

PromQL queries can get expensive fast, especially when agents start running heavy aggregations. mnemopay gates by agent trust score — new agents get limited query complexity, trusted ones get full access. also meters per-query if you want to charge downstream.

it's 2 lines in your tool handler. designed for exactly this kind of metering.

github.com/mnemopay/mnemopay-sdk

if it's not the right time, no worries at all.

Jerry`
  },
  {
    to: "info@kontext.dev",
    subject: "Re: billing for browser-use-mcp sessions",
    text: `hey — circling back on the browser-use-mcp note from last week.

browser automation is probably the highest per-call cost in the MCP ecosystem right now. each session burns real compute. mnemopay lets you pass that cost to the calling agent — sub-cent metering, auto-settlement, and an agent trust score that blocks abusers before they spin up expensive sessions.

github.com/mnemopay/mnemopay-sdk

still have design partner slots open. lmk if you want to chat.

Jerry`
  },
  {
    to: "info@datalayer.ai",
    subject: "Re: metering kernel execution on jupyter-mcp",
    text: `hey — bumping my note from last week about jupyter-mcp.

kernel execution is compute-heavy and uncapped. mnemopay meters per-execution at the tool level — agents pay for what they use, and the trust score auto-blocks agents that try to run infinite loops or mine crypto in your kernels.

2 lines to integrate. designed for exactly this kind of resource metering.

github.com/mnemopay/mnemopay-sdk

if this isn't on your radar yet, no stress. door's open.

Jerry`
  },
  {
    to: "dana_w@designcomputer.com",
    subject: "Re: connection pool gating for mysql_mcp",
    text: `Dana — following up from last week.

database MCP servers have a unique problem: connection pool exhaustion. one rogue agent can burn all your connections. mnemopay's agent trust score gates access automatically — new agents get read-only, trusted ones get full access. also meters per-query if you want to monetize.

github.com/mnemopay/mnemopay-sdk

happy to walk through the implementation if it's interesting. if not, no hard feelings.

Jerry`
  },
  {
    to: "zhicheng@pika.art",
    subject: "Re: MnemoPay billing skill for Pika — PR #10",
    text: `hey Zhicheng — checking in on the MnemoPay billing skill PR (#10).

quick recap: the skill replaces ensure_funded() with Agent FICO-based credit scoring. agents get a trust score (300-850) that determines their spending limits automatically. no pre-funding required for trusted agents.

the PR is clean and tested. happy to make any changes if the team has feedback.

github.com/mnemopay/mnemopay-sdk

Jerry`
  },
  {
    to: "partnerships@wing.com",
    subject: "GridStamp — tamper-proof flight log SDK for Wing's BVLOS compliance stack",
    text: `Hi team,

FAA Part 146 ADSP (mid-2026) will require cryptographic location records for every BVLOS operation. If Wing's current logging stack isn't producing Ed25519-signed, Merkle-anchored flight records today, you'll be retrofitting under deadline pressure.

GridStamp is an open-source TypeScript SDK that wraps any telemetry stream and outputs FAA-ready, tamper-proof proof-of-presence records in 3 lines of code. Apache 2.0. Already on npm (gridstamp). Built for exactly this gap.

We've stress-tested it at 30K transactions with zero integrity failures.

Worth a 20-minute call to see if it fits your Dallas BVLOS stack?

Jerry Omiagbo
jeremiah@getbizsuite.com
getbizsuite.com/gridstamp.html
github.com/mnemopay`
  },
  {
    to: "info@embention.com",
    subject: "GridStamp SDK — tamper-proof audit layer for Veronte autopilot compliance logs",
    text: `Hi,

Amazon Prime Air runs on Veronte. That means your autopilot is already generating the most compliance-sensitive flight data in commercial drone delivery. The missing piece: a cryptographically verifiable audit trail that regulators and insurers can independently verify without trusting your servers.

GridStamp is a sidecar TypeScript SDK — 3 lines of code — that wraps any telemetry stream (including Veronte output) in a Merkle-verified, Ed25519-signed proof-of-presence chain. FAA Part 146 and EU U-Space both point toward mandatory cryptographic flight records. Veronte + GridStamp gets your customers ahead of that requirement without touching your core certification.

Apache 2.0. npm install gridstamp. Zero vendor lock-in.

Open to a technical conversation if this fits Embention's integration roadmap?

Jerry Omiagbo
jeremiah@getbizsuite.com
getbizsuite.com/gridstamp.html
github.com/mnemopay`
  },
  {
    to: "ines@klaimee.co",
    subject: "Re: The actuarial data layer you need to price AI agent risk",
    text: `Hey Ines — quick follow-up.

The ISO CGL exclusions for AI claims went into effect this year, which means every enterprise deploying agents needs documented governance evidence to qualify for coverage. MnemoPay produces that evidence automatically — behavioral FICO scores, Merkle-verified audit trails, anomaly detection logs.

Still think there's a data layer partnership worth exploring. Open to a quick async Loom if a call doesn't fit the schedule.

Jerry Omiagbo
MnemoPay / J&B Enterprise LLC
getbizsuite.com/mnemopay`
  }
];

async function sendEmail(email, index) {
  const res = await fetch("https://smtp.maileroo.com/api/v2/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MAILEROO_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: { address: "jeremiah@getbizsuite.com", display_name: "Jerry Omiagbo" },
      to: { address: email.to },
      subject: email.subject,
      plain: email.text
    })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`[${index + 1}/14] FAILED → ${email.to}: ${JSON.stringify(data)}`);
    return { success: false, to: email.to, error: data };
  }

  console.log(`[${index + 1}/14] SENT → ${email.to} (id: ${data.message_id || data.id || 'ok'})`);
  return { success: true, to: email.to, id: data.message_id || data.id };
}

async function main() {
  const { filterEmails } = await import("./suppression.js");
  const { passed, skipped } = filterEmails(emails, { dedupeWindowDays: 3 });

  console.log(`\nSending ${passed.length} Day-4 follow-ups from ${FROM}\n`);

  const results = [];
  for (let i = 0; i < passed.length; i++) {
    const result = await sendEmail(passed[i], i);
    results.push(result);
    if (i < passed.length - 1) await new Promise(r => setTimeout(r, 150));
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n--- SUMMARY ---`);
  console.log(`Sent: ${sent}/${passed.length} | Skipped: ${skipped.length}`);
  if (failed > 0) {
    console.log(`Failed: ${failed}`);
    results.filter(r => !r.success).forEach(r => console.log(`  - ${r.to}: ${JSON.stringify(r.error)}`));
  }
}

main().catch(console.error);
