#!/usr/bin/env node
/**
 * MnemoPay AutoPost — Real API posting to Twitter, LinkedIn, Reddit, Dev.to
 *
 * This is the execution layer. pipeline.js generates content, autopost.js ships it.
 *
 * Usage:
 *   node autopost.js twitter "Your tweet text here"
 *   node autopost.js linkedin "Post title" "Post body"
 *   node autopost.js devto                              — Publish draft article
 *   node autopost.js reddit "subreddit" "title" "body"
 *   node autopost.js schedule                           — Post all scheduled content
 *   node autopost.js status                             — Check API connection status
 *
 * Env vars:
 *   TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 *   LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (token via linkedin-auth.js)
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 *   DEVTO_API_KEY
 *   GROQ_API_KEY (optional — for AI-generated content)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, "data", "post-log.json");
const CONTENT_FILE = path.join(__dirname, "data", "content-queue.json");

// Ensure data dir
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── TWITTER API (OAuth 1.0a) ─────────────────────────────────────────────

function twitterOAuthHeader(method, url, params = {}) {
  const key = process.env.TWITTER_API_KEY;
  const secret = process.env.TWITTER_API_SECRET;
  const token = process.env.TWITTER_ACCESS_TOKEN;
  const tokenSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!key || !secret || !token || !tokenSecret) return null;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const oauthParams = {
    oauth_consumer_key: key,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: token,
    oauth_version: "1.0",
    ...params,
  };

  const sortedParams = Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join("&");

  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(secret)}&${encodeURIComponent(tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  return `OAuth ${Object.entries({
    ...oauthParams,
    oauth_signature: signature,
  }).filter(([k]) => k.startsWith("oauth_"))
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ")}`;
}

async function postTweet(text, inReplyToId) {
  const url = "https://api.twitter.com/2/tweets";
  const auth = twitterOAuthHeader("POST", url);
  if (!auth) throw new Error("Twitter credentials not configured");

  const body = { text };
  if (inReplyToId) body.reply = { in_reply_to_tweet_id: String(inReplyToId) };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Twitter API error: ${JSON.stringify(data)}`);
  return { id: data.data?.id, url: `https://twitter.com/i/status/${data.data?.id}` };
}

// ─── LINKEDIN API (v2 /rest/posts — April 2025+) ────────────────────────────

const LINKEDIN_TOKEN_FILE = path.join(__dirname, "data", "linkedin-token.json");
const LINKEDIN_API_VERSION = "202503";

/**
 * Load LinkedIn token from data/linkedin-token.json.
 * Auto-refreshes if token is near expiry and refresh token is available.
 * Falls back to LINKEDIN_ACCESS_TOKEN env var for backward compatibility.
 */
async function getLinkedInAuth() {
  // Try token file first
  if (fs.existsSync(LINKEDIN_TOKEN_FILE)) {
    try {
      // Dynamic import to use the exported helper from linkedin-auth.js
      const { getLinkedInToken } = await import("./linkedin-auth.js");
      return await getLinkedInToken();
    } catch (err) {
      // If import fails (e.g., missing client creds for refresh), try reading token file directly
      try {
        const tokenData = JSON.parse(fs.readFileSync(LINKEDIN_TOKEN_FILE, "utf8"));
        if (tokenData.access_token) {
          const expiresAt = tokenData.access_token_expires_at
            ? new Date(tokenData.access_token_expires_at)
            : null;
          if (expiresAt && expiresAt <= new Date()) {
            throw new Error("LinkedIn token expired. Run: node marketing/linkedin-auth.js");
          }
          return {
            access_token: tokenData.access_token,
            person_urn: tokenData.person_urn,
          };
        }
      } catch (readErr) {
        if (readErr.message.includes("expired")) throw readErr;
      }
    }
  }

  // Fallback: env var (backward compatible)
  const envToken = process.env.LINKEDIN_ACCESS_TOKEN;
  if (envToken) return { access_token: envToken, person_urn: null };

  throw new Error(
    "LinkedIn not configured. Run: node marketing/linkedin-auth.js"
  );
}

/**
 * Resolve the person URN. Uses cached value from token file, or fetches via /rest/userinfo.
 */
async function resolvePersonUrn(accessToken, cachedUrn) {
  if (cachedUrn) return cachedUrn;

  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch LinkedIn profile: ${res.status}`);
  }
  const me = await res.json();
  return `urn:li:person:${me.sub}`;
}

/**
 * Post to LinkedIn using the /rest/posts API.
 * Supports text-only posts and text + article link posts.
 *
 * @param {string} text - Post commentary text
 * @param {object} [article] - Optional article: { url, title, description }
 */
async function postLinkedIn(text, article) {
  const auth = await getLinkedInAuth();
  const personUrn = await resolvePersonUrn(auth.access_token, auth.person_urn);

  const headers = {
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };

  // Build post body per LinkedIn /rest/posts spec
  const postBody = {
    author: personUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
  };

  // If an article link is provided, attach it
  if (article && article.url) {
    postBody.content = {
      article: {
        source: article.url,
        title: article.title || "",
        description: article.description || "",
      },
    };
  }

  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers,
    body: JSON.stringify(postBody),
  });

  // LinkedIn /rest/posts returns 201 with x-restli-id header, empty body on success
  if (res.status === 201) {
    const postId = res.headers.get("x-restli-id");
    return { id: postId, status: "published" };
  }

  // Try to parse error body
  let errorData;
  try {
    errorData = await res.json();
  } catch {
    errorData = { status: res.status, statusText: res.statusText };
  }
  throw new Error(`LinkedIn API error (${res.status}): ${JSON.stringify(errorData)}`);
}

// ─── REDDIT API ───────────────────────────────────────────────────────────

async function getRedditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const user = process.env.REDDIT_USERNAME;
  const pass = process.env.REDDIT_PASSWORD;
  if (!id || !secret || !user || !pass) throw new Error("Reddit credentials not configured");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=password&username=${user}&password=${pass}`,
  });

  const data = await res.json();
  return data.access_token;
}

async function postReddit(subreddit, title, text) {
  const token = await getRedditToken();

  const res = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "MnemoPay-Bot/1.0",
    },
    body: new URLSearchParams({
      kind: "self",
      sr: subreddit,
      title,
      text,
      api_type: "json",
    }),
  });

  const data = await res.json();
  return { url: data?.json?.data?.url };
}

// ─── DEV.TO API ───────────────────────────────────────────────────────────

async function postDevTo(title, body, tags = []) {
  const key = process.env.DEVTO_API_KEY;
  if (!key) throw new Error("DEVTO_API_KEY not configured");

  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      article: {
        title,
        body_markdown: body,
        published: false, // Draft first, review before publishing
        tags: tags.slice(0, 4), // Dev.to max 4 tags
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Dev.to API error: ${JSON.stringify(data)}`);
  return { id: data.id, url: data.url };
}

// ─── SCHEDULING ENGINE ───────────────────────────────────────────────────

function logPost(platform, content, result) {
  const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, "utf8")) : [];
  log.push({
    platform,
    content: content.substring(0, 200),
    result,
    postedAt: new Date().toISOString(),
  });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

async function scheduleAll() {
  if (!fs.existsSync(CONTENT_FILE)) {
    console.log("  No content queued. Run: node pipeline.js generate");
    return;
  }

  const queue = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
  const scheduled = queue.filter(q => q.status === "scheduled");

  if (scheduled.length === 0) {
    console.log("  All content posted. Run: node pipeline.js generate");
    return;
  }

  console.log(`\n  Posting ${scheduled.length} scheduled items...\n`);

  for (const item of scheduled) {
    try {
      let result;

      switch (item.platform.toLowerCase()) {
        case "twitter":
          result = await postTweet(item.content);
          break;
        case "linkedin":
          result = await postLinkedIn(item.content);
          break;
        case "reddit":
          result = await postReddit("artificial", "MnemoPay — AI Agent Trust & Commerce SDK", item.content);
          break;
        default:
          console.log(`  [SKIP] ${item.platform} — no API handler`);
          continue;
      }

      item.status = "posted";
      item.postedAt = new Date().toISOString();
      item.result = result;
      logPost(item.platform, item.content, result);
      console.log(`  [OK] ${item.platform}: ${item.content.substring(0, 60)}...`);

    } catch (err) {
      item.status = "failed";
      item.error = err.message;
      console.log(`  [FAIL] ${item.platform}: ${err.message}`);
    }
  }

  fs.writeFileSync(CONTENT_FILE, JSON.stringify(queue, null, 2));
  console.log(`\n  Done. Check post-log.json for results.\n`);
}

async function checkStatus() {
  console.log("\n  API Connection Status\n");
  console.log("  ┌──────────────┬────────────┬──────────────────┐");
  console.log("  │ Platform     │ Status     │ Limit            │");
  console.log("  ├──────────────┼────────────┼──────────────────┤");

  const checks = [
    {
      name: "Twitter/X",
      check: () => !!process.env.TWITTER_API_KEY && !!process.env.TWITTER_ACCESS_TOKEN,
      limit: "1,500 tweets/mo",
    },
    {
      name: "LinkedIn",
      check: () => {
        if (process.env.LINKEDIN_ACCESS_TOKEN) return true;
        try {
          if (fs.existsSync(LINKEDIN_TOKEN_FILE)) {
            const t = JSON.parse(fs.readFileSync(LINKEDIN_TOKEN_FILE, "utf8"));
            return !!t.access_token && new Date(t.access_token_expires_at) > new Date();
          }
        } catch {}
        return false;
      },
      limit: "Unlimited",
    },
    {
      name: "Reddit",
      check: () => !!process.env.REDDIT_CLIENT_ID,
      limit: "100 posts/24h",
    },
    {
      name: "Dev.to",
      check: () => !!process.env.DEVTO_API_KEY,
      limit: "Unlimited drafts",
    },
    {
      name: "Groq AI",
      check: () => !!process.env.GROQ_API_KEY,
      limit: "30 req/min (free)",
    },
    {
      name: "Resend Email",
      check: () => !!process.env.RESEND_API_KEY,
      limit: "3K emails/mo",
    },
  ];

  for (const c of checks) {
    const ok = c.check();
    const status = ok ? "Connected" : "Not Set";
    const icon = ok ? "+" : "-";
    console.log(`  │ ${c.name.padEnd(12)} │ ${icon} ${status.padEnd(9)}│ ${c.limit.padEnd(16)} │`);
  }

  console.log("  └──────────────┴────────────┴──────────────────┘");

  // Post history
  if (fs.existsSync(LOG_FILE)) {
    const log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    console.log(`\n  Post History: ${log.length} total posts`);
    const recent = log.slice(-5);
    for (const p of recent) {
      console.log(`    ${p.postedAt.substring(0, 10)} [${p.platform}] ${p.content.substring(0, 50)}...`);
    }
  }
  console.log();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

switch (command) {
  case "twitter":
    postTweet(args[0]).then(r => {
      console.log(`  Posted: ${r.url}`);
      logPost("twitter", args[0], r);
    }).catch(e => console.error(`  Error: ${e.message}`));
    break;

  case "reply":
    // node autopost.js reply "<text>" <in_reply_to_tweet_id>
    postTweet(args[0], args[1]).then(r => {
      console.log(`  Replied: ${r.url}`);
      logPost("twitter-reply", `${args[1]}: ${args[0]}`, r);
    }).catch(e => console.error(`  Error: ${e.message}`));
    break;

  case "linkedin": {
    // Usage: node autopost.js linkedin "post text"
    //   or:  node autopost.js linkedin "post text" --url "https://..." --title "..." --desc "..."
    const liText = args[0] || "";
    const urlIdx = args.indexOf("--url");
    const titleIdx = args.indexOf("--title");
    const descIdx = args.indexOf("--desc");
    const article = urlIdx !== -1 ? {
      url: args[urlIdx + 1] || "",
      title: titleIdx !== -1 ? args[titleIdx + 1] || "" : "",
      description: descIdx !== -1 ? args[descIdx + 1] || "" : "",
    } : undefined;
    postLinkedIn(liText, article).then(r => {
      console.log(`  Posted: ${JSON.stringify(r)}`);
      logPost("linkedin", liText, r);
    }).catch(e => console.error(`  Error: ${e.message}`));
    break;
  }

  case "reddit":
    postReddit(args[0], args[1], args.slice(2).join(" ")).then(r => {
      console.log(`  Posted: ${r.url}`);
      logPost("reddit", args[1], r);
    }).catch(e => console.error(`  Error: ${e.message}`));
    break;

  case "devto": {
    const mdFile = path.join(__dirname, "devto-tutorial.md");
    if (!fs.existsSync(mdFile)) { console.log("  devto-tutorial.md not found"); break; }
    const md = fs.readFileSync(mdFile, "utf8");
    const titleMatch = md.match(/^title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1] : "MnemoPay Tutorial";
    postDevTo(title, md, ["ai", "javascript", "node", "webdev"]).then(r => {
      console.log(`  Draft created: ${r.url}`);
      logPost("devto", title, r);
    }).catch(e => console.error(`  Error: ${e.message}`));
    break;
  }

  case "schedule":
    scheduleAll();
    break;

  case "status":
    checkStatus();
    break;

  default:
    console.log(`
  MnemoPay AutoPost — Social Media API Posting

  Commands:
    node autopost.js twitter "tweet text"         Post a tweet
    node autopost.js linkedin "post text"         Post text to LinkedIn
    node autopost.js linkedin "text" --url URL    Post with article link
    node autopost.js reddit "sub" "title" "body"  Post to Reddit
    node autopost.js devto                        Publish Dev.to draft
    node autopost.js schedule                     Post all queued content
    node autopost.js status                       Check API connections
`);
}
