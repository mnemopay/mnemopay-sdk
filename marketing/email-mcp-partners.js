#!/usr/bin/env node
/**
 * MnemoPay MCP Partner Outreach
 *
 * Parses gtm/outreach/mcp-authors.md, generates personalised cold emails,
 * and sends via Resend API. Only sends to authors with a real email address.
 *
 * Usage:
 *   node email-mcp-partners.js preview 5        — print first 5 emails, no send
 *   node email-mcp-partners.js send --limit 10  — send to first 10 authors
 *   node email-mcp-partners.js status           — show who has been contacted
 *
 * Env vars (optional — can also hardcode below):
 *   RESEND_API_KEY
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────

const RESEND_API_KEY   = process.env.RESEND_API_KEY || 're_3fQFwACB_4nxKE4CmSJF2mKZrtDfj5jLj';
const FROM             = 'Jerry Omiagbo <jeremiah@getbizsuite.com>';
const CALENDLY         = 'https://calendly.com/jerry-omiagbo/15min';

const DATA_DIR         = path.join(__dirname, 'data');
const LOG_FILE         = path.join(DATA_DIR, 'mcp-partner-log.json');
const AUTHORS_FILE     = path.join(
  __dirname, '..', 'gtm', 'outreach', 'mcp-authors.md'
);

// ─── HELPERS ───────────────────────────────────────────────────────────────

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function saveJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Naive check: does the string look like a real email address?
function isEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((str || '').trim());
}

// ─── PARSER ────────────────────────────────────────────────────────────────
// Parse the markdown table. Columns:
//   Repo | Author | Stars / Last push | What it does | Contact | Hook
//
// The Contact cell can contain: an email, a GitHub link, a Twitter handle,
// blog URL, or some combination. We extract only real email addresses.

function parseAuthors(mdContent) {
  const lines   = mdContent.split('\n');
  const authors = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;              // not a table row
    const cells = line.split('|').map(c => c.trim()); // ['', col1, col2, ..., '']
    if (cells.length < 7) continue;

    const repoCell    = cells[1];
    const authorCell  = cells[2];
    const whatCell    = cells[4];
    const contactCell = cells[5];
    const hookCell    = cells[6];

    // Skip header / divider rows
    if (repoCell.startsWith('Repo') || repoCell.startsWith('---') || repoCell === '') continue;

    // Extract repo short name (e.g. "stickerdaniel/linkedin-mcp-server")
    const repoMatch = repoCell.match(/\[([^\]]+)\]/);
    const repoFull  = repoMatch ? repoMatch[1] : repoCell.replace(/[[\]()]/g, '').trim();
    const repoParts = repoFull.split('/');
    const repoName  = repoParts[repoParts.length - 1] || repoFull;

    // Extract author name (strip markdown links)
    const authorName = authorCell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

    // Extract email from contact cell — look for any word matching email pattern
    const emailMatches = contactCell.match(/[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/g);
    const email        = emailMatches ? emailMatches[0] : null;

    // Strip markdown from hook
    const hook = hookCell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

    // Strip markdown from what-it-does
    const whatItDoes = whatCell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

    authors.push({
      repoName,
      repoFull,
      authorName,
      email,
      hook,
      whatItDoes,
    });
  }

  return authors;
}

// ─── EMAIL TEMPLATE ────────────────────────────────────────────────────────

function buildEmail(author) {
  const { authorName, repoName, hook, whatItDoes } = author;

  // Extract first name only
  const firstName = authorName.split(/[\s-]/)[0];

  const subject = `Per-call billing for ${repoName}`;

  const html = `<p>Hey ${firstName},</p>

<p>Saw <strong>${repoName}</strong> — ${hook}</p>

<p>Built MnemoPay specifically for this: it gives MCP servers per-call billing, agent memory, and spending limits in ~5 lines.</p>

<pre style="background:#f4f4f4;padding:12px;border-radius:4px;font-size:13px;">// in your MCP tool handler
await agent.charge(0.002, '${repoName}:call');
// that's it — billing, escrow, and reputation handled</pre>

<p>Free forever for the first 10 MCP servers. No credit card.</p>

<p>Worth 15 min? → <a href="${CALENDLY}">${CALENDLY}</a></p>

<p>Jerry</p>`;

  const text = `Hey ${firstName},

Saw ${repoName} — ${hook}

Built MnemoPay specifically for this: it gives MCP servers per-call billing, agent memory, and spending limits in ~5 lines.

Free forever for the first 10 MCP servers. No credit card.

Worth 15 min? → ${CALENDLY}

Jerry`;

  return { subject, html, text };
}

// ─── SEND VIA RESEND ───────────────────────────────────────────────────────

async function sendEmail(to, subject, html, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

// ─── COMMANDS ──────────────────────────────────────────────────────────────

function getAuthorsWithEmail() {
  if (!fs.existsSync(AUTHORS_FILE)) {
    console.error(`ERROR: Cannot find mcp-authors.md at:\n  ${AUTHORS_FILE}`);
    process.exit(1);
  }

  const md      = fs.readFileSync(AUTHORS_FILE, 'utf-8');
  const all     = parseAuthors(md);
  const withEmail = all.filter(a => isEmail(a.email));

  return { all, withEmail };
}

function cmdPreview(limitArg) {
  const limit = parseInt(limitArg, 10) || 5;
  const { all, withEmail } = getAuthorsWithEmail();

  console.log(`\nParsed ${all.length} authors total, ${withEmail.length} have email addresses.\n`);
  console.log(`Previewing first ${Math.min(limit, withEmail.length)} emails:\n`);
  console.log('═'.repeat(70));

  for (let i = 0; i < Math.min(limit, withEmail.length); i++) {
    const author = withEmail[i];
    const email  = buildEmail(author);

    console.log(`\n[${i + 1}] TO: ${author.email}`);
    console.log(`    AUTHOR: ${author.authorName}`);
    console.log(`    REPO:   ${author.repoFull}`);
    console.log(`    SUBJECT: ${email.subject}`);
    console.log('\n--- BODY (text) ---');
    console.log(email.text);
    console.log('─'.repeat(70));
  }

  console.log(`\nTo send: node email-mcp-partners.js send --limit ${limit}\n`);
}

async function cmdSend(args) {
  const limitIdx = args.indexOf('--limit');
  const limit    = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10;

  const { all, withEmail } = getAuthorsWithEmail();
  const log = loadJSON(LOG_FILE, {});

  // Skip already-sent + cross-script suppression
  let blocked = new Set(Object.keys(log));
  try {
    const { getSuppressed, getRecentlySent } = require("./suppression.cjs");
    const suppressed = getSuppressed();
    const recent = getRecentlySent(3);
    for (const addr of suppressed) blocked.add(addr);
    for (const [addr] of recent) blocked.add(addr);
    console.log(`Suppression: ${suppressed.size} suppressed, ${recent.size} recently sent`);
  } catch (e) { console.log("(suppression check unavailable:", e.message, ")"); }
  const toSend = withEmail.filter(a => !blocked.has(a.email)).slice(0, limit);

  console.log(`\n${withEmail.length} authors with email. ${Object.keys(log).length} already contacted.`);
  console.log(`Sending to ${toSend.length} authors (limit: ${limit})...\n`);

  if (toSend.length === 0) {
    console.log('Nothing to send. All eligible authors already contacted.\n');
    return;
  }

  let sent = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const author of toSend) {
    const email = buildEmail(author);
    try {
      const result = await sendEmail(author.email, email.subject, email.html, email.text);
      log[author.email] = {
        authorName: author.authorName,
        repoName:   author.repoName,
        subject:    email.subject,
        sentAt:     now,
        resendId:   result.id || null,
        status:     'sent',
      };
      saveJSON(LOG_FILE, log);
      console.log(`  [SENT]   ${author.email} (${author.repoName})`);
      sent++;
      // 200ms rate limit between sends
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      log[author.email] = {
        authorName: author.authorName,
        repoName:   author.repoName,
        subject:    email.subject,
        sentAt:     now,
        status:     'failed',
        error:      err.message,
      };
      saveJSON(LOG_FILE, log);
      console.error(`  [FAIL]   ${author.email} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n--- Done: ${sent} sent, ${failed} failed ---\n`);
}

function cmdStatus() {
  const { all, withEmail } = getAuthorsWithEmail();
  const log = loadJSON(LOG_FILE, {});

  const contacted = Object.keys(log).length;
  const remaining = withEmail.filter(a => !log[a.email]).length;

  console.log('\n' + '═'.repeat(60));
  console.log('  MCP Partner Outreach — Status');
  console.log('═'.repeat(60));
  console.log(`\n  Total authors parsed       : ${all.length}`);
  console.log(`  Authors with email         : ${withEmail.length}`);
  console.log(`  Authors without email      : ${all.length - withEmail.length}`);
  console.log(`  Contacted (sent)           : ${contacted}`);
  console.log(`  Remaining to contact       : ${remaining}`);

  if (contacted > 0) {
    const failures = Object.values(log).filter(e => e.status === 'failed').length;
    console.log(`  Send failures              : ${failures}`);
    console.log('\n  Recently sent:');
    const entries = Object.entries(log).slice(-10);
    for (const [email, entry] of entries) {
      const status = entry.status === 'sent' ? '[OK]' : '[FAIL]';
      console.log(`    ${status} ${email} — ${entry.repoName}`);
    }
  }

  console.log('\n');
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

(async () => {
  if (cmd === 'preview') {
    cmdPreview(rest[0]);
  } else if (cmd === 'send') {
    await cmdSend(rest);
  } else if (cmd === 'status') {
    cmdStatus();
  } else {
    console.log([
      '',
      'Usage:',
      '  node email-mcp-partners.js preview 5          — preview first 5 emails',
      '  node email-mcp-partners.js send --limit 10    — send to first 10 authors',
      '  node email-mcp-partners.js status             — show outreach status',
      '',
    ].join('\n'));
    process.exit(1);
  }
})();
