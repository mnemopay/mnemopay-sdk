#!/usr/bin/env node
/**
 * MnemoPay CRM — Lead pipeline tracker
 *
 * Usage:
 *   node crm.js report   — full funnel + stage distribution
 *   node crm.js hot      — leads emailed but no follow-up yet
 *   node crm.js next     — who needs follow-up today
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PROSPECTS_FILE = path.join(DATA_DIR, 'prospects.json');
const DRIP_LOG_FILE  = path.join(DATA_DIR, 'drip-log.json');

// ─── KNOWN SENT EMAILS (sourced from email-followup.js) ────────────────────
// sentDate is the original send date (YYYY-MM-DD)
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
  { email: 'blazickjp@amazon.com',              sentDate: '2026-04-10', type: 'mcp-author' },
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

// Derive a CRM status for each sent email based on drip-log state
function deriveStatus(email, dripEntry) {
  if (!dripEntry) return 'contacted';           // emailed, no log entry yet
  if (dripEntry.followup2) return 'followed_up_d7'; // both follow-ups done
  if (dripEntry.followup1) return 'followed_up_d3'; // day-3 sent
  return 'contacted';                            // emailed, day-3 not yet sent
}

// Build enriched lead list
function buildLeads(dripLog) {
  const prospectData = loadJSON(PROSPECTS_FILE, { prospects: [] });
  const prospectMap  = {};
  for (const p of prospectData.prospects) {
    prospectMap[p.email.toLowerCase()] = p;
  }

  return SENT_EMAILS.map(sent => {
    const dripEntry = dripLog[sent.email] || dripLog[sent.email.toLowerCase()] || null;
    const prospect  = prospectMap[sent.email.toLowerCase()] || {};
    const status    = deriveStatus(sent.email, dripEntry);
    const days      = daysSince(sent.sentDate);

    return {
      email:      sent.email,
      name:       prospect.name || '—',
      company:    prospect.company || '—',
      type:       sent.type,
      sentDate:   sent.sentDate,
      daysAgo:    days,
      status,
      fu1:        dripEntry ? dripEntry.followup1 : null,
      fu2:        dripEntry ? dripEntry.followup2 : null,
    };
  });
}

// Determine what follow-ups are needed today
function needsFollowUp(lead) {
  const actions = [];
  if (lead.type === 'strategic') return actions;  // handled manually

  if (lead.daysAgo >= 3 && !lead.fu1) {
    actions.push('Day 3 follow-up');
  }
  if (lead.daysAgo >= 7 && lead.fu1 && !lead.fu2) {
    actions.push('Day 7 follow-up');
  }
  return actions;
}

// ─── TABLE HELPERS ─────────────────────────────────────────────────────────

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function hr(char, len) { return char.repeat(len); }

// ─── COMMANDS ──────────────────────────────────────────────────────────────

function cmdReport() {
  const dripLog = loadJSON(DRIP_LOG_FILE, {});
  const leads   = buildLeads(dripLog);

  // Funnel counts
  const total      = leads.length;
  const emailed    = leads.length;  // all in list were emailed
  const fu1Sent    = leads.filter(l => l.fu1).length;
  const fu2Sent    = leads.filter(l => l.fu2).length;
  // replied / meeting / won — manual data not tracked yet, placeholders
  const replied    = 0;
  const meeting    = 0;
  const won        = 0;
  const lost       = 0;

  console.log('\n' + hr('═', 60));
  console.log('  MnemoPay CRM — Full Funnel Report');
  console.log('  ' + new Date().toLocaleDateString('en-US', { dateStyle: 'long' }));
  console.log(hr('═', 60));

  console.log('\n### Funnel\n');
  console.log(`  Total prospects in DB : ${total}`);
  console.log(`  Initial email sent    : ${emailed}`);
  console.log(`  Day-3 follow-up sent  : ${fu1Sent}`);
  console.log(`  Day-7 follow-up sent  : ${fu2Sent}`);
  console.log(`  Replied               : ${replied}  ← update manually`);
  console.log(`  Meeting booked        : ${meeting}  ← update manually`);
  console.log(`  Won / Lost            : ${won} / ${lost}  ← update manually`);

  // Stage distribution table
  const stageCounts = {};
  for (const l of leads) {
    stageCounts[l.status] = (stageCounts[l.status] || 0) + 1;
  }

  console.log('\n### Stage Distribution\n');
  console.log('  ' + pad('Stage', 22) + pad('Count', 8) + 'Description');
  console.log('  ' + hr('-', 55));
  const stageDesc = {
    contacted:         'Emailed, awaiting response',
    followed_up_d3:    'Day-3 bump sent',
    followed_up_d7:    'Day-7 breakup sent (drip complete)',
    replied:           'Replied (manual)',
    meeting_booked:    'Meeting scheduled (manual)',
    won:               'Customer (manual)',
    lost:              'Dead (manual)',
  };
  for (const [stage, count] of Object.entries(stageCounts)) {
    console.log('  ' + pad(stage, 22) + pad(count, 8) + (stageDesc[stage] || ''));
  }

  // Type breakdown
  const typeCounts = {};
  for (const l of leads) {
    typeCounts[l.type] = (typeCounts[l.type] || 0) + 1;
  }
  console.log('\n### By Segment\n');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${pad(type, 22)} ${count}`);
  }

  console.log('\n' + hr('─', 60));
  console.log('  Run `node crm.js hot`  to see hot leads');
  console.log('  Run `node crm.js next` to see follow-ups due today');
  console.log(hr('─', 60) + '\n');
}

function cmdHot() {
  const dripLog = loadJSON(DRIP_LOG_FILE, {});
  const leads   = buildLeads(dripLog);

  // Hot = emailed but no Day-3 follow-up yet (3+ days ago)
  const hot = leads.filter(l => l.daysAgo >= 3 && !l.fu1 && l.type !== 'strategic');

  console.log('\n' + hr('═', 70));
  console.log('  Hot Leads — emailed 3+ days ago, no follow-up sent yet');
  console.log(hr('═', 70));

  if (hot.length === 0) {
    console.log('\n  No hot leads right now. All contacted leads are in follow-up.\n');
    return;
  }

  console.log('\n  ' + pad('Email', 36) + pad('Name', 22) + pad('Days', 6) + 'Segment');
  console.log('  ' + hr('-', 68));
  for (const l of hot) {
    console.log('  ' + pad(l.email, 36) + pad(l.name, 22) + pad(l.daysAgo, 6) + l.type);
  }
  console.log(`\n  Total: ${hot.length} hot leads\n`);
}

function cmdNext() {
  const dripLog = loadJSON(DRIP_LOG_FILE, {});
  const leads   = buildLeads(dripLog);

  const d3Due = leads.filter(l => l.daysAgo >= 3 && !l.fu1 && l.type !== 'strategic');
  const d7Due = leads.filter(l => l.daysAgo >= 7 && l.fu1 && !l.fu2 && l.type !== 'strategic');

  console.log('\n' + hr('═', 70));
  console.log('  Next Actions — Follow-ups due today');
  console.log(hr('═', 70));

  if (d3Due.length === 0 && d7Due.length === 0) {
    console.log('\n  Nothing due today. Check back tomorrow.\n');
    return;
  }

  if (d3Due.length > 0) {
    console.log(`\n  Day-3 follow-ups needed (${d3Due.length}):\n`);
    console.log('  ' + pad('Email', 36) + pad('Name', 22) + pad('Sent', 12) + 'Days ago');
    console.log('  ' + hr('-', 72));
    for (const l of d3Due) {
      console.log('  ' + pad(l.email, 36) + pad(l.name, 22) + pad(l.sentDate, 12) + l.daysAgo);
    }
  }

  if (d7Due.length > 0) {
    console.log(`\n  Day-7 follow-ups needed (${d7Due.length}):\n`);
    console.log('  ' + pad('Email', 36) + pad('Name', 22) + pad('Sent', 12) + 'Days ago');
    console.log('  ' + hr('-', 72));
    for (const l of d7Due) {
      console.log('  ' + pad(l.email, 36) + pad(l.name, 22) + pad(l.sentDate, 12) + l.daysAgo);
    }
  }

  console.log(`\n  Run: node email-followup.js send  to execute follow-ups\n`);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'report';
if      (cmd === 'report') cmdReport();
else if (cmd === 'hot')    cmdHot();
else if (cmd === 'next')   cmdNext();
else {
  console.log('Usage: node crm.js [report|hot|next]');
  process.exit(1);
}
