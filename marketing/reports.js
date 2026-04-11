#!/usr/bin/env node
/**
 * MnemoPay Weekly Marketing Report
 *
 * Aggregates data from all marketing pipeline files and prints
 * a clean markdown summary to stdout.
 *
 * Usage:
 *   node reports.js weekly
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR          = path.join(__dirname, 'data');
const DRIP_LOG_FILE     = path.join(DATA_DIR, 'drip-log.json');
const POST_LOG_FILE     = path.join(DATA_DIR, 'post-log.json');
const PROSPECTS_FILE    = path.join(DATA_DIR, 'prospects.json');
const MCP_LOG_FILE      = path.join(DATA_DIR, 'mcp-partner-log.json');

// Sent email list mirrored from email-followup.js (source of truth for drip)
// type: b2b-dev | gridstamp-tier1 | mcp-author | strategic
const SENT_EMAILS = [
  { email: 'cbornet@hotmail.com',                sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'ihower@gmail.com',                   sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'bigmiao.zhang@gmail.com',            sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'mmrhaq@gmail.com',                   sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'hssein.mzannar@gmail.com',           sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'bratanic.tomaz@gmail.com',           sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'devkhant24@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'iamtonykipkemboi@gmail.com',         sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'alex.mojaki@gmail.com',              sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: '13schishti@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'ps4534@nyu.edu',                     sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'shaokun.zhang@psu.edu',              sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'smaxmail@gmail.com',                 sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: '2t.antoine@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'sungjinhong@devsisters.com',         sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'mail@anush.sh',                      sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'massimiliano.pronesti@gmail.com',    sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'cliu_whu@yeah.net',                  sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'bboynton97@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'brizdigital@gmail.com',              sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'umermk3@gmail.com',                  sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'mthw.wm.robinson@gmail.com',         sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'hironow365@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'liugddx@gmail.com',                  sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'greyson.r.lalonde@gmail.com',        sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'ofer@vectara.com',                   sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'raj.725@outlook.com',                sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'olaoluwaasalami@gmail.com',          sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'leo.gan.57@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'aliymn.db@gmail.com',                sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'kushalkhare.official@gmail.com',     sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'landonmutch@protonmail.com',         sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'longfinfunnel@gmail.com',            sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'invokerkrishna@gmail.com',           sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'zhaoyunhello@gmail.com',             sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'dennison+github@dennisonbertram.com',sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'tim@garthwaite.org',                 sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'its.everdred@gmail.com',             sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'alanrsoars@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'freemorphism@gmail.com',             sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: '7ayushgupta@gmail.com',              sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'akshatm408@gmail.com',               sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'ewan01@novix.team',                  sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'ashishkingdom@proton.me',            sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'Ahmed.Ibrahhim@Outlook.com',         sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'vini@hey.com',                       sentDate: '2026-04-08', type: 'b2b-dev' },
  { email: 'zhicheng@pika.art',                  sentDate: '2026-04-08', type: 'strategic' },
  { email: 'sergey@koop.ai',                     sentDate: '2026-04-10', type: 'gridstamp-tier1' },
  { email: 'andrei@dexory.com',                  sentDate: '2026-04-10', type: 'gridstamp-tier1' },
  { email: 'rick@locusrobotics.com',             sentDate: '2026-04-10', type: 'gridstamp-tier1' },
  { email: 'kevin@bedrockrobotics.com',          sentDate: '2026-04-10', type: 'gridstamp-tier1' },
  { email: 'ahti.heinla@starship.xyz',           sentDate: '2026-04-10', type: 'gridstamp-tier1' },
  { email: 'hello@ref.tools',                    sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'dana_w@designcomputer.com',          sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'taylor@taylorwilsdon.com',           sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'sergey.parfenyuk@gmail.com',         sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'soomiles.dev@gmail.com',             sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'karthik@techgeek.co.in',             sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'sulenescinar@gmail.com',             sentDate: '2026-04-10', type: 'mcp-author' },
  { email: 'blazickjp@amazon.com',               sentDate: '2026-04-10', type: 'mcp-author' },
];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function daysSince(dateStr) {
  const sent = new Date(dateStr);
  const now  = new Date();
  return Math.floor((now - sent) / (1000 * 60 * 60 * 24));
}

function fmtDate(iso) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── REPORT ────────────────────────────────────────────────────────────────

function cmdWeekly() {
  const dripLog   = loadJSON(DRIP_LOG_FILE, {});
  const postLog   = loadJSON(POST_LOG_FILE, []);
  const prospects = loadJSON(PROSPECTS_FILE, { prospects: [] });
  const mcpLog    = loadJSON(MCP_LOG_FILE, {});

  const today = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });

  // ── Email pipeline ──────────────────────────────────────────────────────

  // Total initial sends (exclude strategic for drip count)
  const dripEmails     = SENT_EMAILS.filter(e => e.type !== 'strategic');
  const initialSent    = SENT_EMAILS.length;        // everything that went out
  const dripTotal      = dripEmails.length;

  const fu1Sent        = Object.values(dripLog).filter(e => e.followup1).length;
  const fu2Sent        = Object.values(dripLog).filter(e => e.followup2).length;
  const dripComplete   = Object.values(dripLog).filter(e => e.followup1 && e.followup2).length;

  // Next-action counts
  const d3Due = dripEmails.filter(e => {
    const entry = dripLog[e.email];
    return daysSince(e.sentDate) >= 3 && !(entry && entry.followup1);
  }).length;

  const d7Due = dripEmails.filter(e => {
    const entry = dripLog[e.email];
    return daysSince(e.sentDate) >= 7 && entry && entry.followup1 && !entry.followup2;
  }).length;

  // Segment breakdown
  const segCounts = {};
  for (const e of SENT_EMAILS) {
    segCounts[e.type] = (segCounts[e.type] || 0) + 1;
  }

  // Stage distribution from prospects.json (if stage field exists) —
  // otherwise derive from drip log
  const prospectList = prospects.prospects || [];
  const stageCounts  = {};
  for (const e of SENT_EMAILS) {
    const entry  = dripLog[e.email];
    let stage;
    if (!entry)                   stage = 'contacted';
    else if (entry.followup2)     stage = 'drip_complete';
    else if (entry.followup1)     stage = 'followed_up_d3';
    else                          stage = 'contacted';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }

  // ── Content ─────────────────────────────────────────────────────────────

  const devtoPosts    = postLog.filter(p => p.platform === 'devto');
  const twitterPosts  = postLog.filter(p => p.platform === 'twitter');
  const linkedinPosts = postLog.filter(p => p.platform === 'linkedin');

  // ── MCP Partners ────────────────────────────────────────────────────────

  const mcpContacted = Object.keys(mcpLog).length;
  const mcpFailed    = Object.values(mcpLog).filter(e => e.status === 'failed').length;
  const mcpSent      = mcpContacted - mcpFailed;

  // ── Output ──────────────────────────────────────────────────────────────

  const lines = [
    `## MnemoPay Marketing Report — ${today}`,
    '',
    '### Email Pipeline',
    `- Prospects in database: ${prospectList.length}`,
    `- Initial emails sent: ${initialSent} (across all segments)`,
    `  - B2B dev outreach: ${segCounts['b2b-dev'] || 0}`,
    `  - MCP author outreach: ${(segCounts['mcp-author'] || 0) + mcpSent}`,
    `  - GridStamp tier-1: ${segCounts['gridstamp-tier1'] || 0}`,
    `  - Strategic: ${segCounts['strategic'] || 0}`,
    `- Day-3 follow-ups sent: ${fu1Sent}`,
    `- Day-7 follow-ups sent: ${fu2Sent}`,
    `- Full drip complete: ${dripComplete} / ${dripTotal}`,
    '',
    '### Stage Distribution',
  ];

  for (const [stage, count] of Object.entries(stageCounts)) {
    lines.push(`- ${stage}: ${count}`);
  }

  lines.push('');
  lines.push('### Content');
  lines.push(`- Posts published (all time): ${postLog.length}`);
  lines.push(`- Dev.to articles: ${devtoPosts.length}`);
  lines.push(`- Twitter posts: ${twitterPosts.length}`);
  lines.push(`- LinkedIn posts: ${linkedinPosts.length}`);

  if (devtoPosts.length > 0) {
    lines.push('');
    lines.push('  Recent articles:');
    for (const p of devtoPosts) {
      const title = (p.content || '').slice(0, 60);
      const date  = fmtDate(p.publishedAt || p.postedAt);
      lines.push(`  - "${title}" — ${date}`);
    }
  }

  lines.push('');
  lines.push('### MCP Partner Program');
  lines.push(`- Partners contacted (email-mcp-partners.js): ${mcpSent}`);
  lines.push(`- Partners contacted (email-followup.js):     ${segCounts['mcp-author'] || 0}`);
  lines.push(`- Send failures: ${mcpFailed}`);

  lines.push('');
  lines.push('### Next Actions');

  if (d3Due > 0) {
    lines.push(`- ${d3Due} prospect(s) need Day-3 follow-up → run: node email-followup.js send`);
  } else {
    lines.push('- No Day-3 follow-ups pending');
  }

  if (d7Due > 0) {
    lines.push(`- ${d7Due} prospect(s) need Day-7 follow-up → run: node email-followup.js send`);
  } else {
    lines.push('- No Day-7 follow-ups pending');
  }

  lines.push('');
  lines.push('---');
  lines.push(`_Generated by reports.js at ${new Date().toISOString()}_`);
  lines.push('');

  console.log(lines.join('\n'));
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'weekly';

if (cmd === 'weekly') {
  cmdWeekly();
} else {
  console.log('Usage: node reports.js weekly');
  process.exit(1);
}
