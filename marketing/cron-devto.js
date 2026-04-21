#!/usr/bin/env node
/**
 * Dev.to weekly publisher with idempotent guard.
 *
 * Runs daily but only publishes on the configured weekday (default: Monday).
 * State lives at marketing/data/devto-published.json so re-runs are safe
 * even if the cron fires twice.
 *
 * Drops new articles into marketing/devto-queue/*.md — anything not yet
 * marked as published in the state file becomes this week's post.
 *
 * Usage:
 *   node cron-devto.js               — run once (cron-compatible)
 *   node cron-devto.js --force       — publish even if not the scheduled weekday
 *   node cron-devto.js --dry-run     — show what would publish, no API call
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "devto-published.json");
const QUEUE_DIR = path.join(__dirname, "devto-queue");
const FALLBACK_FILE = path.join(__dirname, "devto-tutorial.md");

const PUBLISH_WEEKDAY = 1;

function loadEnv() {
  const envFiles = [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")];
  for (const f of envFiles) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  }
}
loadEnv();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { published: {} }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { title: null, tags: [] };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const eq = line.indexOf(":");
    if (eq === -1) continue;
    fm[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const title = fm.title || null;
  const tags = (fm.tags || "").replace(/^\[|\]$/g, "").split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return { title, tags };
}

function pickNextArticle(state) {
  const candidates = [];
  if (fs.existsSync(QUEUE_DIR)) {
    for (const f of fs.readdirSync(QUEUE_DIR).filter(n => n.endsWith(".md")).sort()) {
      candidates.push(path.join(QUEUE_DIR, f));
    }
  }
  if (!candidates.length && fs.existsSync(FALLBACK_FILE)) candidates.push(FALLBACK_FILE);
  for (const f of candidates) {
    const key = path.basename(f);
    if (!state.published[key]) return { file: f, key };
  }
  return null;
}

async function publish(title, body, tags) {
  const key = process.env.DEVTO_API_KEY;
  if (!key) throw new Error("DEVTO_API_KEY not set");
  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      article: {
        title,
        body_markdown: body,
        published: true,
        tags: tags.slice(0, 4),
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Dev.to API error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");

  const todayDow = new Date().getDay();
  if (!force && todayDow !== PUBLISH_WEEKDAY) {
    console.log(`[devto-cron] Not publish day (today=${todayDow}, target=${PUBLISH_WEEKDAY}). Skip.`);
    return;
  }

  const state = loadState();
  const next = pickNextArticle(state);
  if (!next) {
    console.log("[devto-cron] No unpublished articles in queue or fallback. Nothing to do.");
    return;
  }

  const md = fs.readFileSync(next.file, "utf8");
  const { title, tags } = parseFrontmatter(md);
  if (!title) {
    console.error(`[devto-cron] ${next.key} missing title in frontmatter. Skip.`);
    return;
  }

  const defaultTags = ["ai", "javascript", "node", "webdev"];
  const finalTags = tags.length ? tags : defaultTags;

  if (dryRun) {
    console.log(`[devto-cron] DRY RUN — would publish: ${next.key} | title="${title}" | tags=${finalTags.join(",")}`);
    return;
  }

  try {
    const res = await publish(title, md, finalTags);
    state.published[next.key] = {
      publishedAt: new Date().toISOString(),
      url: res.url || null,
      id: res.id || null,
    };
    saveState(state);
    console.log(`[devto-cron] Published: ${next.key} → ${res.url || res.id}`);
  } catch (e) {
    console.error(`[devto-cron] Publish failed for ${next.key}: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
