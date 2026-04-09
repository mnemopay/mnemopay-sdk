#!/usr/bin/env node
/**
 * MnemoPay Daily Marketing Automation
 *
 * Runs on schedule via Windows Task Scheduler or cron.
 * Posts 2 tweets/day + 1 LinkedIn/week from the content bank.
 *
 * Usage:
 *   node daily-marketing.js              — Run daily routine (2 tweets)
 *   node daily-marketing.js weekly       — Run weekly routine (2 tweets + 1 LinkedIn)
 *   node daily-marketing.js status       — Show what's been posted
 *   node daily-marketing.js test         — Dry run (print what would post, don't actually post)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "daily-log.json");
const CONTENT_FILE = path.join(DATA_DIR, "content-queue.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── ENV VARS ──────────────────────────────────────────────────────────────
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const DEVTO_API_KEY = process.env.DEVTO_API_KEY;

// ─── CONTENT BANK ──────────────────────────────────────────────────────────
const TWEETS = [
  `Every AI agent starts every session completely blank. No memory of who it served. No wallet. No identity.\n\nMnemoPay: memory + payments + identity in one SDK. 14 modules. Zero penny drift.\n\nnpm install @mnemopay/sdk`,
  `Your agent can close a deal but can't remember the customer's name 5 minutes later.\n\nMnemoPay gives agents cognitive memory backed by neuroscience. Ebbinghaus decay + Hebbian reinforcement.\n\nnpm install @mnemopay/sdk`,
  `Building payment infrastructure for AI agents from scratch?\n\nStripe integration. Escrow logic. Ledger math. Fraud detection.\n\nThat's 6 months of work.\n\nOr: npm install @mnemopay/sdk\n\n5 lines. Done.`,
  `$87M+ in competitor funding across 6 companies.\n\nNone of them have all 6 layers:\nMemory + Payments + Identity + Fraud + Ledger + Multi-Agent\n\nMnemoPay has all 6. On $0 funding.\n\ngetbizsuite.com/mnemopay`,
  `5,000+ transactions per second.\n37,000+ fraud checks per second.\n10,000 ledger entries verified in 16ms.\n\nMnemoPay isn't a prototype. It's production infrastructure.\n\nnpm install @mnemopay/sdk`,
  `Without MnemoPay:\n- Build Stripe integration\n- Write escrow logic\n- Hope the math is right\n\nWith MnemoPay:\n- npm install @mnemopay/sdk\n- 5 lines of code\n- 14 production modules guarantee it works`,
  `Mem0: $24M raised. Memory only.\nSkyfire: $9.5M raised. Payments only.\nKite: $33M raised. Payments + identity only.\n\nMnemoPay: $0 raised. All 6 layers.\n\nBootstrap > venture.\n\ngetbizsuite.com/mnemopay`,
  `The agent economy needs its own credit bureau.\n\nMemory IS the credit file. Every transaction, every interaction — that's how you build a FICO score for AI agents.\n\nAgent FICO. 300-850. Live now.\nnpm install @mnemopay/sdk`,
  `If your AI agent can spend $10,000 but can't remember who it paid yesterday, you have a very expensive problem.\n\nMnemoPay: memory + payments + identity.\nnpm install @mnemopay/sdk`,
  `Everyone building agent payments forgot one thing:\n\nThe agent needs to REMEMBER who it's paying and why.\n\nPayments without memory is a bank account with amnesia.\n\nWe built both.\nnpm install @mnemopay/sdk`,
  `AI agents are spending real money. But there's no standard for controlling HOW they spend it.\n\nNo budget caps. No approval gates. No escrow. No audit trail.\n\nMnemoPay's transaction mandate system fixes all of that. 14 modules.`,
  `Stripe, Google, OpenAI, and Visa all launched agent payment protocols in 2026.\n\nBut none of them ship: memory + escrow + fraud detection + identity in one npm install.\n\nMnemoPay does. Open source.\ngetbizsuite.com/mnemopay`,
  `We stress-tested MnemoPay with 1,000 random transactions.\n\nFee + net = gross. Every single time.\nDebit + credit = zero. Always.\n\nDouble-entry bookkeeping since 1494. Still undefeated.`,
  `The agent commerce wars just started.\n\nPerplexity vs Amazon. Google vs Walmart. Stripe vs PayPal.\n\nBut nobody built the financial infrastructure layer.\n\nThe escrow, mandates, fraud detection, and audit trail that ANY agent needs.\n\nThat's MnemoPay.`,
  `You walk into a bank. They pull your credit score. 750. Approved.\n\nAn AI agent walks into a bank. They pull its credit score.\n\nIt doesn't have one.\n\nWe built Agent FICO. 300-850. The first credit bureau for AI agents.\n\nnpm install @mnemopay/sdk`,
  `Eighty-seven million dollars. That's how much VCs poured into agent infrastructure.\n\nEvery one of them built one, maybe two features.\n\nWe built all fourteen modules. On zero.\n\n14 modules. Zero penny drift.\ngetbizsuite.com/mnemopay`,
  `The $10.91B agent economy needs banking infrastructure.\n\nNot another chatbot. Not another wrapper.\n\nReal payment rails. Real credit scoring. Real fraud detection.\n\nMnemoPay. Agent banking.\nnpm install @mnemopay/sdk`,
];

// ─── TWITTER OAuth 1.0a ────────────────────────────────────────────────────
function twitterOAuthHeader(method, url, params = {}) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return null;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const oauthParams = {
    oauth_consumer_key: TWITTER_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_version: "1.0",
    ...params,
  };

  const sortedParams = Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join("&");

  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(TWITTER_API_SECRET)}&${encodeURIComponent(TWITTER_ACCESS_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  return `OAuth ${Object.entries({
    ...oauthParams,
    oauth_signature: signature,
  }).filter(([k]) => k.startsWith("oauth_"))
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ")}`;
}

async function postTweet(text) {
  const url = "https://api.twitter.com/2/tweets";
  const auth = twitterOAuthHeader("POST", url);
  if (!auth) throw new Error("Twitter credentials not set");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Twitter error: ${JSON.stringify(data)}`);
  return { id: data.data?.id, url: `https://twitter.com/i/status/${data.data?.id}` };
}

// ─── LOGGING ───────────────────────────────────────────────────────────────
function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_FILE, "utf-8")); }
  catch { return { posts: [], lastRun: null, tweetIndex: 0 }; }
}

function saveLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ─── DAILY ROUTINE ─────────────────────────────────────────────────────────
async function daily(dryRun = false) {
  const log = loadLog();
  const today = new Date().toISOString().slice(0, 10);

  // Check if already ran today
  if (log.lastRun === today && !dryRun) {
    console.log(`Already posted today (${today}). Skipping.`);
    return;
  }

  // Pick 2 tweets (round-robin through the bank)
  let idx = log.tweetIndex || 0;
  const tweet1 = TWEETS[idx % TWEETS.length];
  const tweet2 = TWEETS[(idx + 1) % TWEETS.length];

  console.log(`\n--- Tweet 1 (index ${idx % TWEETS.length}) ---`);
  console.log(tweet1.slice(0, 100) + "...");

  console.log(`\n--- Tweet 2 (index ${(idx + 1) % TWEETS.length}) ---`);
  console.log(tweet2.slice(0, 100) + "...");

  if (dryRun) {
    console.log("\n[DRY RUN] Would post the above 2 tweets.");
    return;
  }

  // Post tweets with 30-min gap
  try {
    const result1 = await postTweet(tweet1);
    console.log(`\nTweet 1 posted: ${result1.url}`);
    log.posts.push({ date: today, platform: "twitter", index: idx % TWEETS.length, id: result1.id });
  } catch (e) {
    console.error(`Tweet 1 failed: ${e.message}`);
  }

  // Wait 30 minutes between tweets to look natural
  console.log("Waiting 30 minutes before tweet 2...");
  await new Promise(r => setTimeout(r, 30 * 60 * 1000));

  try {
    const result2 = await postTweet(tweet2);
    console.log(`Tweet 2 posted: ${result2.url}`);
    log.posts.push({ date: today, platform: "twitter", index: (idx + 1) % TWEETS.length, id: result2.id });
  } catch (e) {
    console.error(`Tweet 2 failed: ${e.message}`);
  }

  log.tweetIndex = (idx + 2) % TWEETS.length;
  log.lastRun = today;
  saveLog(log);
  console.log(`\nDone. Next tweets will start from index ${log.tweetIndex}.`);
}

// ─── STATUS ────────────────────────────────────────────────────────────────
function status() {
  const log = loadLog();
  console.log(`Last run: ${log.lastRun || "never"}`);
  console.log(`Tweet index: ${log.tweetIndex || 0}/${TWEETS.length}`);
  console.log(`Total posts: ${(log.posts || []).length}`);
  const recent = (log.posts || []).slice(-5);
  if (recent.length) {
    console.log("\nRecent posts:");
    recent.forEach(p => console.log(`  ${p.date} | ${p.platform} | index ${p.index}`));
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || "daily";
if (cmd === "status") status();
else if (cmd === "test") daily(true);
else if (cmd === "weekly") daily(false); // same as daily for now, LinkedIn needs OAuth
else daily(false);
