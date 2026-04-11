#!/usr/bin/env node
/**
 * MnemoPay Analytics — Dev.to + post metrics
 *
 * Usage:
 *   node analytics.js devto    — fetch Dev.to article metrics and print table
 *   node analytics.js report   — full weekly content performance summary
 *
 * Requires Node 18+ (built-in fetch).
 * No extra npm dependencies.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR      = path.join(__dirname, 'data');
const POST_LOG_FILE = path.join(DATA_DIR, 'post-log.json');

const DEVTO_API_KEY = 'HJUMTzRUqdYcRffcaJWnovWk';
const DEVTO_BASE    = 'https://dev.to/api';

// ─── HELPERS ───────────────────────────────────────────────────────────────

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function pad(str, len) {
  str = String(str == null ? '—' : str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function hr(char, len) { return char.repeat(len); }

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── DEVTO FETCH ───────────────────────────────────────────────────────────

async function fetchDevtoArticle(id) {
  const url = `${DEVTO_BASE}/articles/${id}`;
  try {
    const res = await fetch(url, {
      headers: {
        'api-key': DEVTO_API_KEY,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ─── COMMANDS ──────────────────────────────────────────────────────────────

async function cmdDevto() {
  const postLog = loadJSON(POST_LOG_FILE, []);

  // Filter to Dev.to posts that have an article ID
  const devtoPosts = postLog.filter(p =>
    p.platform === 'devto' && p.result && p.result.id
  );

  if (devtoPosts.length === 0) {
    console.log('\n  No Dev.to articles found in post-log.json.\n');
    return;
  }

  console.log(`\nFetching metrics for ${devtoPosts.length} Dev.to article(s)...\n`);

  const rows = [];
  for (const post of devtoPosts) {
    const data = await fetchDevtoArticle(post.result.id);
    rows.push({
      id:          post.result.id,
      title:       data.error ? post.content : (data.title || post.content),
      views:       data.error ? '—' : (data.page_views_count ?? data.public_reactions_count ?? '—'),
      reactions:   data.error ? '—' : (data.public_reactions_count ?? '—'),
      comments:    data.error ? '—' : (data.comments_count ?? '—'),
      published:   data.error ? post.publishedAt : (data.published_at || post.publishedAt),
      url:         post.result.url || '—',
      error:       data.error || null,
    });
    // Polite rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Print table
  const titleW = 52;
  console.log(hr('═', 100));
  console.log('  Dev.to Article Metrics');
  console.log(hr('═', 100));
  console.log('\n  ' +
    pad('Title', titleW) +
    pad('Views', 8) +
    pad('React', 7) +
    pad('Cmts', 6) +
    'Published'
  );
  console.log('  ' + hr('-', 96));

  for (const r of rows) {
    if (r.error) {
      console.log('  ' + pad(r.title, titleW) + `  ERROR: ${r.error}`);
    } else {
      console.log('  ' +
        pad(r.title, titleW) +
        pad(r.views, 8) +
        pad(r.reactions, 7) +
        pad(r.comments, 6) +
        fmtDate(r.published)
      );
    }
  }

  console.log('\n  ' + hr('-', 96));

  const totalViews     = rows.filter(r => !r.error && r.views !== '—').reduce((s, r) => s + Number(r.views || 0), 0);
  const totalReactions = rows.filter(r => !r.error && r.reactions !== '—').reduce((s, r) => s + Number(r.reactions || 0), 0);
  const totalComments  = rows.filter(r => !r.error && r.comments !== '—').reduce((s, r) => s + Number(r.comments || 0), 0);

  console.log('  ' +
    pad('TOTALS', titleW) +
    pad(totalViews, 8) +
    pad(totalReactions, 7) +
    totalComments
  );
  console.log('\n');
}

async function cmdReport() {
  const postLog = loadJSON(POST_LOG_FILE, []);

  const devtoPosts    = postLog.filter(p => p.platform === 'devto');
  const twitterPosts  = postLog.filter(p => p.platform === 'twitter');
  const linkedinPosts = postLog.filter(p => p.platform === 'linkedin');
  const total         = postLog.length;

  console.log('\n' + hr('═', 60));
  console.log('  MnemoPay — Weekly Content Performance Report');
  console.log('  ' + new Date().toLocaleDateString('en-US', { dateStyle: 'long' }));
  console.log(hr('═', 60));

  console.log('\n### Posts Published (all time)\n');
  console.log(`  Total posts logged    : ${total}`);
  console.log(`  Dev.to articles       : ${devtoPosts.length}`);
  console.log(`  Twitter posts         : ${twitterPosts.length}`);
  console.log(`  LinkedIn posts        : ${linkedinPosts.length}`);

  if (devtoPosts.length > 0) {
    console.log('\n### Recent Dev.to Articles\n');
    console.log('  ' + pad('Title', 50) + pad('Posted', 14) + 'URL');
    console.log('  ' + hr('-', 90));
    for (const p of devtoPosts) {
      const title = (p.content || '').slice(0, 48);
      const date  = fmtDate(p.publishedAt || p.postedAt);
      const url   = (p.result && p.result.url) ? p.result.url : '—';
      console.log('  ' + pad(title, 50) + pad(date, 14) + url);
    }
    console.log('\n  Tip: run `node analytics.js devto` to fetch live view/reaction counts.');
  }

  console.log('\n' + hr('─', 60) + '\n');
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'report';

(async () => {
  if      (cmd === 'devto')  await cmdDevto();
  else if (cmd === 'report') await cmdReport();
  else {
    console.log('Usage: node analytics.js [devto|report]');
    process.exit(1);
  }
})();
