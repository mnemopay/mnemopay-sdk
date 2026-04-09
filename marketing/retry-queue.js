#!/usr/bin/env node
/**
 * Retry failed queue items through channels that currently work.
 *
 *   - Twitter failures: paused (credits depleted). Requires plan top-up.
 *   - LinkedIn failures: repurposed as published Dev.to articles.
 *   - Reddit failures: paused (skipped by user request).
 *
 * Usage:
 *   DEVTO_API_KEY=... node retry-queue.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.join(__dirname, "data", "content-queue.json");
const LOG = path.join(__dirname, "data", "post-log.json");

const DEVTO_KEY = process.env.DEVTO_API_KEY;
if (!DEVTO_KEY) {
  console.error("DEVTO_API_KEY not set.");
  process.exit(1);
}

// Pull a compelling title from the first line of a LinkedIn post.
function titleFrom(content) {
  const first = content.split("\n")[0].replace(/["']/g, "").trim();
  // Dev.to titles: <= ~128 chars, no trailing punctuation for hook feel.
  return first.length > 120 ? first.slice(0, 117) + "..." : first;
}

// Format a LinkedIn post into a short Dev.to article.
function formatBody(content) {
  const lines = content.split("\n");
  const title = titleFrom(content);
  const rest = lines.slice(1).join("\n").trim();
  return [
    `> ${title}`,
    "",
    rest,
    "",
    "---",
    "",
    "*Originally posted on LinkedIn. Try MnemoPay: `npm install @mnemopay/sdk`*",
  ].join("\n");
}

async function postDevTo(title, body, tags) {
  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "api-key": DEVTO_KEY, "Content-Type": "application/json" },
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
  if (!res.ok) throw new Error(`Dev.to API error: ${JSON.stringify(data)}`);
  return { id: data.id, url: data.url, publishedAt: data.published_at };
}

function loadJson(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; }
}

async function main() {
  const queue = loadJson(QUEUE, []);
  const log = loadJson(LOG, []);

  let posted = 0, paused = 0;

  for (const item of queue) {
    if (item.status !== "failed") continue;
    const platform = item.platform.toLowerCase();

    if (platform === "twitter") {
      item.status = "paused";
      item.pauseReason = "Twitter API credits depleted on account 2041444724368674816. Top up plan to resume.";
      paused++;
      continue;
    }

    if (platform === "reddit") {
      item.status = "paused";
      item.pauseReason = "Reddit skipped per user request.";
      paused++;
      continue;
    }

    if (platform === "linkedin") {
      try {
        const title = titleFrom(item.content);
        const body = formatBody(item.content);
        const res = await postDevTo(title, body, ["ai", "javascript", "agents", "webdev"]);
        item.status = "posted";
        item.postedAt = new Date().toISOString();
        item.repurposedTo = "devto";
        item.result = res;
        log.push({
          platform: "devto",
          content: title,
          result: res,
          postedAt: item.postedAt,
          publishedAt: res.publishedAt,
          originalPlatform: "LinkedIn",
        });
        console.log(`  [OK] devto: ${title}`);
        console.log(`       ${res.url}`);
        posted++;
      } catch (err) {
        console.log(`  [FAIL] devto: ${err.message}`);
      }
    }
  }

  fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2));
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
  console.log(`\n  Done. Posted=${posted} Paused=${paused}`);
}

main().catch(e => { console.error(e); process.exit(1); });
