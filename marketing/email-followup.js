#!/usr/bin/env node
/**
 * MnemoPay Email Follow-Up Drip
 *
 * Checks sent B2B emails and sends follow-ups on schedule.
 * Day 3: Short bump. Day 7: Breakup email.
 *
 * Usage:
 *   node email-followup.js check     — Show who needs follow-ups today
 *   node email-followup.js send      — Actually send follow-ups
 *   node email-followup.js status    — Show full pipeline status
 *
 * Env vars:
 *   RESEND_API_KEY — Resend API key for sending
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DRIP_LOG = path.join(DATA_DIR, "drip-log.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = "Jerry Omiagbo <jeremiah@getbizsuite.com>";

// ─── B2B PROSPECTS (sent on 2026-04-08) ────────────────────────────────────
// These are the 47 emails we sent. The drip tracks who's gotten follow-ups.
const SENT_EMAILS = [
  // "Your agents handle money but can't remember customers" batch
  { email: "cbornet@hotmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "ihower@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "bigmiao.zhang@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "mmrhaq@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "hssein.mzannar@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "bratanic.tomaz@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "devkhant24@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "iamtonykipkemboi@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "alex.mojaki@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "13schishti@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "ps4534@nyu.edu", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "shaokun.zhang@psu.edu", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "smaxmail@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "2t.antoine@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "sungjinhong@devsisters.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "mail@anush.sh", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "massimiliano.pronesti@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "cliu_whu@yeah.net", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "bboynton97@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "brizdigital@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "umermk3@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "mthw.wm.robinson@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "hironow365@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "liugddx@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "greyson.r.lalonde@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "ofer@vectara.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "raj.725@outlook.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "olaoluwaasalami@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "leo.gan.57@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "aliymn.db@gmail.com", subject: "Your agents handle money but can't remember customers", sentDate: "2026-04-08", type: "b2b-dev" },
  // "Escrow + reputation" batch
  { email: "kushalkhare.official@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "landonmutch@protonmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "longfinfunnel@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "invokerkrishna@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "zhaoyunhello@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "dennison+github@dennisonbertram.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "tim@garthwaite.org", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "its.everdred@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "alanrsoars@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "freemorphism@gmail.com", subject: "Escrow + reputation for agent-to-agent transactions", sentDate: "2026-04-08", type: "b2b-dev" },
  // "Stop building payment infra" batch
  { email: "7ayushgupta@gmail.com", subject: "Stop building payment infra from scratch for your agents", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "akshatm408@gmail.com", subject: "Stop building payment infra from scratch for your agents", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "ewan01@novix.team", subject: "Stop building payment infra from scratch for your agents", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "ashishkingdom@proton.me", subject: "Stop building payment infra from scratch for your agents", sentDate: "2026-04-08", type: "b2b-dev" },
  { email: "Ahmed.Ibrahhim@Outlook.com", subject: "Stop building payment infra from scratch for your agents", sentDate: "2026-04-08", type: "b2b-dev" },
  // CrewAI specific
  { email: "vini@hey.com", subject: "Agent commerce layer for CrewAI users", sentDate: "2026-04-08", type: "b2b-dev" },
  // Pika
  { email: "zhicheng@pika.art", subject: "your ensure_funded() pattern — built you a replacement", sentDate: "2026-04-08", type: "strategic" },
  // GridStamp Tier 1 outreach (sent 2026-04-10)
  { email: "sergey@koop.ai", subject: "the RoboticsTomorrow billing problem — we built the fix", sentDate: "2026-04-10", type: "gridstamp-tier1" },
  { email: "andrei@dexory.com", subject: "making Dexory scans cryptographically verifiable", sentDate: "2026-04-10", type: "gridstamp-tier1" },
  { email: "rick@locusrobotics.com", subject: "independent pick verification for RaaS billing", sentDate: "2026-04-10", type: "gridstamp-tier1" },
  { email: "kevin@bedrockrobotics.com", subject: "spatial proof for construction milestone billing", sentDate: "2026-04-10", type: "gridstamp-tier1" },
  { email: "ahti.heinla@starship.xyz", subject: "cryptographic proof-of-delivery for 2,700 robots", sentDate: "2026-04-10", type: "gridstamp-tier1" },

  // MCP Server Author outreach (sent 2026-04-10)
  { email: "hello@ref.tools", subject: "re: per-call billing for MCP servers — saw Ref's credit system", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "dana_w@designcomputer.com", subject: "monetize your MySQL MCP server — per-query billing in 2 lines", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "taylor@taylorwilsdon.com", subject: "monetize your Google Workspace MCP server", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "sergey.parfenyuk@gmail.com", subject: "mcp-proxy + billing middleware — natural fit", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "soomiles.dev@gmail.com", subject: "monetize your Atlassian MCP server — Jira/Confluence per-call billing", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "karthik@techgeek.co.in", subject: "monetize your Playwright MCP server — per-invocation billing", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "sulenescinar@gmail.com", subject: "monetize your Twitter MCP server — per-tweet billing", sentDate: "2026-04-10", type: "mcp-author" },
  { email: "blazickjp@amazon.com", subject: "monetize your ArXiv MCP server — per-paper billing", sentDate: "2026-04-10", type: "mcp-author" },
];

// ─── FOLLOW-UP TEMPLATES ───────────────────────────────────────────────────

function followUp1(original) {
  if (original.type === "gridstamp-tier1") {
    return {
      subject: `Re: ${original.subject}`,
      html: `<p>hey, just bumping this — figured it might've gotten buried.</p>
<p>tl;dr: GridStamp gives autonomous robots cryptographic proof-of-presence. one npm install, hash-chained spatial proofs, 2,000+ ops/sec. open source, Apache 2.0.</p>
<p>happy to do a 15-min walkthrough or just point you at the repo.</p>
<p>jerry</p>`,
    };
  }
  if (original.type === "mcp-author") {
    return {
      subject: `Re: ${original.subject}`,
      html: `<p>hey, just bumping this — figured it might've gotten buried.</p>
<p>tl;dr: MnemoPay lets you charge per-tool-call on any MCP server. agent.charge(0.002, "tool_name") — that's it. handles billing, escrow, and reputation scoring so you can focus on your server.</p>
<p>happy to do a 10-min walkthrough or just point you at the <a href="https://github.com/mnemopay/mnemopay-sdk">repo</a>.</p>
<p>jerry</p>`,
    };
  }
  return {
    subject: `Re: ${original.subject}`,
    html: `<p>hey, just bumping this — figured it might've gotten buried.</p>
<p>tl;dr: we built an SDK that gives AI agents memory + payments + identity in one npm install. 14 modules, handles the escrow/fraud/ledger stuff so you don't have to.</p>
<p>happy to send a quick demo or just point you at the repo if you want to poke around.</p>
<p>jerry</p>`,
  };
}

function followUp2(original) {
  if (original.type === "gridstamp-tier1") {
    return {
      subject: `Re: ${original.subject}`,
      html: `<p>closing the loop — GridStamp's open source on GitHub if you ever need cryptographic spatial proofs for your fleet. no hard feelings either way.</p>
<p>jerry</p>`,
    };
  }
  if (original.type === "mcp-author") {
    return {
      subject: `Re: ${original.subject}`,
      html: `<p>closing the loop — MnemoPay's open source on <a href="https://github.com/mnemopay/mnemopay-sdk">GitHub</a> if you ever want to add billing to your MCP server. no hard feelings either way.</p>
<p>jerry</p>`,
    };
  }
  return {
    subject: `Re: ${original.subject}`,
    html: `<p>closing the loop on this one — the SDK's open source if you ever need agent commerce infra. no hard feelings either way.</p>
<p>jerry</p>`,
  };
}

// ─── SEND EMAIL VIA RESEND ─────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

// ─── DRIP LOGIC ────────────────────────────────────────────────────────────
function loadDripLog() {
  try { return JSON.parse(fs.readFileSync(DRIP_LOG, "utf-8")); }
  catch { return {}; }
}

function saveDripLog(log) {
  fs.writeFileSync(DRIP_LOG, JSON.stringify(log, null, 2));
}

function daysSince(dateStr) {
  const sent = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - sent) / (1000 * 60 * 60 * 24));
}

async function checkFollowups(execute = false) {
  const log = loadDripLog();
  const today = new Date().toISOString().slice(0, 10);
  let followup1Count = 0;
  let followup2Count = 0;
  let skipped = 0;

  for (const prospect of SENT_EMAILS) {
    const key = prospect.email;
    const entry = log[key] || { followup1: null, followup2: null };
    const days = daysSince(prospect.sentDate);

    // Skip Pika (strategic, handled separately)
    if (prospect.type === "strategic") continue;

    // Day 3+: send follow-up 1
    if (days >= 3 && !entry.followup1) {
      const fu = followUp1(prospect);
      if (execute) {
        try {
          await sendEmail(prospect.email, fu.subject, fu.html);
          entry.followup1 = today;
          log[key] = entry;
          console.log(`  [FU1] ${prospect.email} — sent`);
          followup1Count++;
          // Rate limit: 100ms between sends
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.error(`  [FU1] ${prospect.email} — FAILED: ${e.message}`);
        }
      } else {
        console.log(`  [FU1 DUE] ${prospect.email} (${days} days since original)`);
        followup1Count++;
      }
    }
    // Day 7+: send follow-up 2 (breakup)
    else if (days >= 7 && entry.followup1 && !entry.followup2) {
      const fu = followUp2(prospect);
      if (execute) {
        try {
          await sendEmail(prospect.email, fu.subject, fu.html);
          entry.followup2 = today;
          log[key] = entry;
          console.log(`  [FU2] ${prospect.email} — sent`);
          followup2Count++;
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.error(`  [FU2] ${prospect.email} — FAILED: ${e.message}`);
        }
      } else {
        console.log(`  [FU2 DUE] ${prospect.email} (${days} days since original)`);
        followup2Count++;
      }
    } else {
      skipped++;
    }
  }

  if (execute) saveDripLog(log);

  console.log(`\n--- Summary ---`);
  console.log(`Follow-up 1: ${followup1Count}`);
  console.log(`Follow-up 2 (breakup): ${followup2Count}`);
  console.log(`Not yet due / already sent: ${skipped}`);
}

function showStatus() {
  const log = loadDripLog();
  const total = SENT_EMAILS.filter(e => e.type !== "strategic").length;
  const fu1Sent = Object.values(log).filter(e => e.followup1).length;
  const fu2Sent = Object.values(log).filter(e => e.followup2).length;
  const complete = Object.values(log).filter(e => e.followup1 && e.followup2).length;

  console.log(`Total prospects: ${total}`);
  console.log(`Follow-up 1 sent: ${fu1Sent}/${total}`);
  console.log(`Follow-up 2 sent: ${fu2Sent}/${total}`);
  console.log(`Drip complete: ${complete}/${total}`);
  console.log(`Remaining: ${total - complete}`);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || "check";
if (cmd === "check") checkFollowups(false);
else if (cmd === "send") checkFollowups(true);
else if (cmd === "status") showStatus();
else console.log("Usage: node email-followup.js [check|send|status]");
