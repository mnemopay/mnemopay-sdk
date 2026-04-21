#!/usr/bin/env node
/**
 * One-off EU AI Act cold email blast.
 * Scheduled for Monday 2026-04-20 09:00 CT via Windows Task Scheduler.
 *
 * Usage:
 *   node send-eu-ai-act.js           — send to all verified prospects
 *   node send-eu-ai-act.js --dry-run — print payloads, no send
 *
 * Idempotency: records sends in data/eu-ai-act-sent.json. Re-running skips
 * anyone already sent. Also appends each send to marketing/email-followup.js
 * drip-log shape so the Day-3/Day-7 drip picks them up automatically.
 *
 * Sender: Maileroo (primary, 300/day). Falls back to Resend if MAILEROO_API_KEY
 * is missing but RESEND_API_KEY is present.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const SENT_LOG = path.join(DATA_DIR, "eu-ai-act-sent.json");
const DRIP_LOG = path.join(DATA_DIR, "drip-log.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadEnv() {
  const envFiles = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;
    const lines = fs.readFileSync(envFile, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    }
  }
}
loadEnv();

const MAILEROO_KEY = process.env.MAILEROO_API_KEY;
const MAILEROO_FROM = process.env.MAILEROO_FROM || "jeremiah@getbizsuite.com";
const MAILEROO_URL = process.env.MAILEROO_API_URL || "https://smtp.maileroo.com/api/v2/emails";
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_NAME = "Jerry Omiagbo";
const FROM = `${FROM_NAME} <${MAILEROO_FROM}>`;

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Prospects (verified send-ready addresses) ──────────────────────────────
// Each gets a genuinely different body — not the same template with a
// swapped-in opener. If two of these could be forwarded to each other and
// read the same, rewrite before sending.
const PROSPECTS = [
  {
    email: "hello@saidot.ai",
    name: "team",
    company: "Saidot",
    subject: "tiny add-on for your AI registry?",
    text:
`hey,

been following what you're building with the AI registry side of things. the piece I keep running into with our users is that registry entries are fine on paper but the underlying agent behavior still isn't tamper-evident once it's running — and article 13 is specifically about that post-hoc audit layer.

I've been working on @mnemopay/sdk — small typescript library, merkle-chained memory + identity tied to a legal entity. drops in around an agent so every recall/charge/decision gets hashed into a chain. apache 2.0 so your team can read the whole thing.

not trying to sell you governance — you already do that. more curious whether it'd be useful as the behavior-log layer under saidot entries. if yes, happy to jump on 15 min. if not, no worries.

jerry
jeremiah@getbizsuite.com`
  },
  {
    email: "sales@saidot.ai",
    name: "there",
    company: "Saidot (sales)",
    subject: "partner angle — agent audit layer",
    text:
`hi there,

different angle than cold pitch — I run MnemoPay (open-source SDK for agent memory + identity) and a few of my users keep asking what to pair it with for the registry side. saidot keeps coming up.

not asking for a sales call. if there's someone on your partnerships side who'd want to swap notes before aug 2 hits, I'd take a 20-min chat. if it's a non-fit or wrong door, just point me somewhere.

repo if useful: github.com/mnemopay/mnemopay-sdk

cheers,
jerry omiagbo
jeremiah@getbizsuite.com`
  },
  {
    email: "hello@trail-ml.com",
    name: "team",
    company: "trail-ml",
    subject: "complementary piece for ml governance?",
    text:
`hey trail-ml,

you're solving ml governance at the pipeline/experiment layer. I'm solving it one layer up at the agent layer — which is the part article 13 and annex iii are about to push hardest on.

the sdk is @mnemopay/sdk. couple of things it does: tamper-evident memory (merkle chain), anomaly detection on behavioral drift, and a credit score that lets you gate risky agents with a hitl step. apache 2.0. ~670 tests.

figured there might be a real overlap with your customer base — they're the same teams buying both. worth a short call, or easier if I just send the repo and you poke around?

jerry
jeremiah@getbizsuite.com
`
  },
  {
    email: "info@dataguard.de",
    name: "DataGuard team",
    company: "DataGuard",
    subject: "re: EU AI Act — small open-source piece that might help",
    text:
`hello,

I know DataGuard sits mostly on the GDPR + compliance-consulting side, so this is half intro, half question.

we ship an open-source sdk (@mnemopay/sdk) aimed at the narrower problem of agent-level audit logs + identity under the AI Act — article 13 audit trail, article 53 traceability, annex iii anomaly + hitl. it's not a consultancy, just a library teams add to their agents. my guess is you get asked "how do we actually implement this" by clients and right now the answer is bespoke.

if it'd be useful to your delivery team to have a pre-vetted technical option to point clients at, happy to walk someone through it. if not, totally understand — just wanted it on your radar before the aug 2 rush.

thanks,
jerry omiagbo
founder, MnemoPay (J&B Enterprise LLC · Dallas, TX)
jeremiah@getbizsuite.com`
  },
  {
    email: "contact@pleias.fr",
    name: "Pleias team",
    company: "Pleias",
    subject: "article 53 + open-weights — might save you some paperwork",
    text:
`hi,

writing because open-weights + eu-native is the exact profile article 53 drafters had in mind, and the disclosure side is going to eat a bunch of your time if you don't have tooling for it.

I built a small thing — @mnemopay/sdk — that wraps agents with merkle-chained memory, an identity registry tied to a legal entity, and anomaly detection. apache 2.0. it's the "infrastructure" side of compliance, not the policy side.

nothing to sell. just curious if you'd want to look at the repo before aug 2 lands and tell me what's missing from an eu-provider perspective. 20 min, your call.

jerry
jeremiah@getbizsuite.com
github.com/mnemopay/mnemopay-sdk`
  },
  {
    email: "data.protection@flixbus.com",
    name: "team",
    company: "FlixBus DPO",
    subject: "quick question on agent audit logs — AI Act",
    text:
`hello,

this is probably the wrong inbox, but I couldn't find a better one — feel free to forward or tell me where to redirect.

short version: any customer-facing agent FlixBus runs (routing recs, support triage, pricing nudges) lands in annex iii territory once aug 2 hits, and article 13 wants a tamper-evident audit log per decision.

I build open-source tooling for that (@mnemopay/sdk — merkle-chained memory + identity + anomaly detection, apache 2.0, ~670 tests). not a pitch — more of a "does this already sit on someone's desk or should I be talking to engineering leadership?"

happy to share details if there's interest. if not, appreciated you reading this far.

jerry omiagbo
jeremiah@getbizsuite.com`
  },
  {
    email: "legal@mistral.ai",
    name: "legal team",
    company: "Mistral",
    subject: "article 53 disclosure tooling — built something open-source",
    text:
`hello,

I know you're getting a lot of eu ai act inbound right now — this is probably the 30th one this week. I'll keep it short.

article 53 disclosure + downstream traceability falls hardest on open-weights providers, which is where mistral sits. I've been building @mnemopay/sdk — open-source typescript (apache 2.0), merkle-chained memory + identity registry tied to legal entity. it's aimed at the downstream agent builders who deploy your models, not at you directly — but having us point at your weights with proper traceability upstream is something you'd probably like to see in the ecosystem.

zero ask. if someone on your side wants to look at the code before aug 2 and flag anything that'd make the integration cleaner for open-weight providers, I'm all ears.

jerry omiagbo
jeremiah@getbizsuite.com
github.com/mnemopay/mnemopay-sdk`
  },
];

function textToHtml(text) {
  return text
    .trim()
    .split(/\n\n+/)
    .map(para => `<p>${para.replace(/\n/g, "<br/>").replace(/&/g, "&amp;")}</p>`)
    .join("\n");
}

async function sendViaMaileroo(to, subject, html, text) {
  const res = await fetch(MAILEROO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MAILEROO_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { address: MAILEROO_FROM, display_name: FROM_NAME },
      to: { address: to },
      subject,
      html,
      plain: text,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Maileroo ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendViaResend(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function loadSent() {
  try {
    return JSON.parse(fs.readFileSync(SENT_LOG, "utf8"));
  } catch {
    return {};
  }
}

function saveSent(log) {
  fs.writeFileSync(SENT_LOG, JSON.stringify(log, null, 2));
}

function appendDripLog(p) {
  let log = {};
  try {
    log = JSON.parse(fs.readFileSync(DRIP_LOG, "utf8"));
  } catch {}
  const today = new Date().toISOString().slice(0, 10);
  log[p.email] = log[p.email] || {};
  log[p.email].originalSent = today;
  log[p.email].type = "eu-ai-act";
  log[p.email].subject = p.subject;
  fs.writeFileSync(DRIP_LOG, JSON.stringify(log, null, 2));
}

async function main() {
  const sent = loadSent();
  let sendCount = 0;
  let skipCount = 0;
  let failCount = 0;

  const provider = MAILEROO_KEY ? "maileroo" : RESEND_KEY ? "resend" : null;
  if (!provider && !DRY_RUN) {
    console.error("[send-eu-ai-act] No MAILEROO_API_KEY or RESEND_API_KEY — abort.");
    process.exit(1);
  }

  console.log(`[send-eu-ai-act] provider=${provider || "(dry-run)"} prospects=${PROSPECTS.length}`);

  for (const p of PROSPECTS) {
    if (sent[p.email]) {
      console.log(`  skip  ${p.email}  (already sent on ${sent[p.email].sentAt})`);
      skipCount++;
      continue;
    }

    const text = p.text;
    const html = textToHtml(text);

    if (DRY_RUN) {
      console.log(`  DRY   ${p.email}  (${p.company})  subject="${p.subject}"  bodyChars=${text.length}`);
      continue;
    }

    try {
      let result;
      if (provider === "maileroo") {
        result = await sendViaMaileroo(p.email, p.subject, html, text);
      } else {
        result = await sendViaResend(p.email, p.subject, html);
      }
      sent[p.email] = {
        company: p.company,
        sentAt: new Date().toISOString(),
        provider,
        resultId: result?.id || result?.reference_id || null,
      };
      saveSent(sent);
      appendDripLog(p);
      console.log(`  sent  ${p.email}  (${p.company})  provider=${provider}`);
      sendCount++;
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  FAIL  ${p.email}  ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n[send-eu-ai-act] done  sent=${sendCount}  skip=${skipCount}  fail=${failCount}`);

  const logLine = `${new Date().toISOString()} eu-ai-act sent=${sendCount} skip=${skipCount} fail=${failCount}\n`;
  const logFile = path.join(__dirname, "logs", "daily.log");
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, logLine);
  } catch {}
}

main().catch(err => {
  console.error("[send-eu-ai-act] fatal:", err);
  process.exit(1);
});
