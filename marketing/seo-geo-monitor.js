#!/usr/bin/env node
/**
 * seo-geo-monitor.js — Check SEO health + GEO visibility for all Jerry's sites.
 * Runs daily via Task Scheduler. Outputs report to logs/seo-geo-report.json
 *
 * Checks:
 *   1. SSL certificate validity
 *   2. HTTP response time
 *   3. Mobile viewport meta tag
 *   4. Sitemap.xml presence
 *   5. robots.txt + AI bot directives (GEO)
 *   6. llms.txt presence (GEO)
 *   7. Schema.org markup
 *   8. OpenGraph / social meta tags
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SITES = [
  { name: "BizSuite", url: "https://getbizsuite.com" },
  { name: "BizSuite AI Audit", url: "https://getbizsuite.com/ai-audit.html" },
  { name: "BizSuite Developers", url: "https://getbizsuite.com/developers/" },
  { name: "BizSuite Ad Factory", url: "https://getbizsuite.com/ad-factory.html" },
];

const AI_BOTS = ["GPTBot", "ChatGPT-User", "Google-Extended", "Anthropic-AI", "ClaudeBot", "PerplexityBot"];

const LOG_DIR = path.join(__dirname, "logs");
const REPORT_PATH = path.join(LOG_DIR, "seo-geo-report.json");

function fetch(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const start = Date.now();
    const req = mod.get(url, { timeout }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          ms: Date.now() - start,
        })
      );
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function checkSSL(hostname) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, port: 443, method: "HEAD" }, (res) => {
      const cert = res.socket.getPeerCertificate();
      resolve({
        valid: !res.socket.authorizationError,
        issuer: cert.issuer?.O || "unknown",
        expires: cert.valid_to || "unknown",
      });
      res.resume();
    });
    req.on("error", () => resolve({ valid: false, issuer: "error", expires: "error" }));
    req.end();
  });
}

async function checkSite(site) {
  const result = { name: site.name, url: site.url, checks: {}, score: 0, maxScore: 0 };
  const hostname = new URL(site.url).hostname;

  // 1. SSL
  result.maxScore += 10;
  try {
    const ssl = await checkSSL(hostname);
    result.checks.ssl = ssl;
    if (ssl.valid) result.score += 10;
  } catch {
    result.checks.ssl = { valid: false, error: "failed" };
  }

  // 2. Response time
  result.maxScore += 10;
  try {
    const res = await fetch(site.url);
    result.checks.responseTime = { ms: res.ms, status: res.status };
    if (res.ms < 2000 && res.status === 200) result.score += 10;
    else if (res.ms < 5000 && res.status === 200) result.score += 5;

    // 3. Mobile viewport
    result.maxScore += 10;
    const hasViewport = /name=["']viewport["']/.test(res.body);
    result.checks.mobileViewport = hasViewport;
    if (hasViewport) result.score += 10;

    // 7. Schema.org
    result.maxScore += 10;
    const hasSchema = /application\/ld\+json/.test(res.body);
    result.checks.schemaOrg = hasSchema;
    if (hasSchema) result.score += 10;

    // 8. OpenGraph
    result.maxScore += 10;
    const hasOG = /property=["']og:/.test(res.body);
    result.checks.openGraph = hasOG;
    if (hasOG) result.score += 10;
  } catch (e) {
    result.checks.responseTime = { error: e.message };
  }

  // 4. Sitemap
  result.maxScore += 10;
  try {
    const sm = await fetch(`https://${hostname}/sitemap.xml`);
    result.checks.sitemap = sm.status === 200;
    if (sm.status === 200) result.score += 10;
  } catch {
    result.checks.sitemap = false;
  }

  // 5. Robots.txt + AI bots
  result.maxScore += 10;
  try {
    const rb = await fetch(`https://${hostname}/robots.txt`);
    const hasRobots = rb.status === 200;
    const allowedBots = AI_BOTS.filter((bot) => rb.body.includes(bot));
    result.checks.robotsTxt = { exists: hasRobots, aiBots: allowedBots, totalBots: AI_BOTS.length };
    if (hasRobots && allowedBots.length >= 3) result.score += 10;
    else if (hasRobots) result.score += 5;
  } catch {
    result.checks.robotsTxt = { exists: false };
  }

  // 6. llms.txt (GEO)
  result.maxScore += 10;
  try {
    const lt = await fetch(`https://${hostname}/llms.txt`);
    result.checks.llmsTxt = lt.status === 200;
    if (lt.status === 200) result.score += 10;
  } catch {
    result.checks.llmsTxt = false;
  }

  result.grade = `${result.score}/${result.maxScore}`;
  return result;
}

async function main() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  console.log(`SEO/GEO Monitor — ${new Date().toISOString()}`);
  console.log(`Checking ${SITES.length} sites...\n`);

  const results = [];
  for (const site of SITES) {
    try {
      const r = await checkSite(site);
      results.push(r);
      const pct = Math.round((r.score / r.maxScore) * 100);
      console.log(`  ${r.name}: ${r.grade} (${pct}%)`);
      if (!r.checks.ssl?.valid) console.log(`    ⚠ SSL issue`);
      if (!r.checks.mobileViewport) console.log(`    ⚠ No mobile viewport`);
      if (!r.checks.sitemap) console.log(`    ⚠ No sitemap.xml`);
      if (!r.checks.llmsTxt) console.log(`    ⚠ No llms.txt (GEO gap)`);
      if (!r.checks.schemaOrg) console.log(`    ⚠ No Schema.org markup`);
      if (!r.checks.openGraph) console.log(`    ⚠ No OpenGraph tags`);
    } catch (e) {
      console.log(`  ${site.name}: ERROR — ${e.message}`);
      results.push({ name: site.name, url: site.url, error: e.message });
    }
  }

  const report = { timestamp: new Date().toISOString(), results };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${REPORT_PATH}`);
}

main().catch(console.error);
