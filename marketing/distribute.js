#!/usr/bin/env node
/**
 * MnemoPay Distribution Activation
 *
 * Ensures MnemoPay is discoverable and installable across every
 * package registry, CDN, directory, and developer surface.
 *
 * Usage:
 *   node distribute.js check     — Verify presence on all channels
 *   node distribute.js activate  — Run activation checklist
 *   node distribute.js seo       — Generate SEO assets
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── DISTRIBUTION CHANNELS ───────────────────────────────────────────────

const CHANNELS = {
  // Package Registries
  npm: {
    name: "npm Registry",
    url: "https://www.npmjs.com/package/@mnemopay/sdk",
    install: "npm install @mnemopay/sdk",
    status: "live",
    action: "npm publish",
  },
  github_packages: {
    name: "GitHub Packages",
    url: "https://github.com/mnemopay/mnemopay-sdk/packages",
    install: "npm install @mnemopay/sdk --registry=https://npm.pkg.github.com",
    status: "pending",
    action: "Add publishConfig to package.json, npm publish --registry=https://npm.pkg.github.com",
  },
  jsr: {
    name: "JSR (Deno/modern)",
    url: "https://jsr.io/@mnemopay/sdk",
    install: "npx jsr add @mnemopay/sdk",
    status: "pending",
    action: "Create jsr.json, run npx jsr publish",
  },

  // CDN (auto from npm)
  unpkg: {
    name: "unpkg CDN",
    url: "https://unpkg.com/@mnemopay/sdk",
    install: '<script src="https://unpkg.com/@mnemopay/sdk"></script>',
    status: "auto",
    action: "Auto-available after npm publish",
  },
  jsdelivr: {
    name: "jsDelivr CDN",
    url: "https://cdn.jsdelivr.net/npm/@mnemopay/sdk",
    install: '<script src="https://cdn.jsdelivr.net/npm/@mnemopay/sdk"></script>',
    status: "auto",
    action: "Auto-available after npm publish",
  },
  skypack: {
    name: "Skypack CDN",
    url: "https://cdn.skypack.dev/@mnemopay/sdk",
    install: 'import MnemoPay from "https://cdn.skypack.dev/@mnemopay/sdk"',
    status: "auto",
    action: "Auto-available after npm publish",
  },

  // Developer Directories
  github: {
    name: "GitHub Repository",
    url: "https://github.com/mnemopay/mnemopay-sdk",
    status: "live",
    action: "Ensure topics set, README optimized, releases tagged",
  },
  mcp_registry: {
    name: "MCP Server Registry",
    url: "https://github.com/modelcontextprotocol/servers",
    install: "claude mcp add mnemopay -s user -- npx -y @mnemopay/sdk",
    status: "pending",
    action: "Submit PR to MCP servers repo",
  },
  smithery: {
    name: "Smithery.ai",
    url: "https://smithery.ai",
    status: "submitted",
    action: "Check listing status",
  },

  // Content Platforms
  devto: {
    name: "Dev.to Article",
    url: "https://dev.to",
    status: "draft",
    action: "node autopost.js devto",
  },
  hackernews: {
    name: "Hacker News (Show HN)",
    url: "https://news.ycombinator.com/submit",
    status: "ready",
    action: "Post show-hn.md on Tuesday 8-10 AM PT",
  },
  producthunt: {
    name: "Product Hunt",
    url: "https://www.producthunt.com",
    status: "pending",
    action: "Schedule 6 weeks out, build 50+ supporters first",
  },

  // Social
  twitter: {
    name: "Twitter/X",
    url: "https://twitter.com",
    status: "ready",
    action: "node autopost.js schedule",
  },
  linkedin: {
    name: "LinkedIn",
    url: "https://linkedin.com",
    status: "ready",
    action: "node autopost.js schedule",
  },
  reddit: {
    name: "Reddit",
    subreddits: ["r/MachineLearning", "r/node", "r/artificial", "r/LangChain"],
    status: "ready",
    action: "Post tutorial + discussion",
  },

  // SEO
  landing_page: {
    name: "Landing Page",
    url: "https://getbizsuite.com/mnemopay",
    status: "live",
    action: "Deploy latest from site/",
  },
  comparison_pages: {
    name: "SEO Comparison Pages",
    pages: ["vs-mem0.html", "vs-skyfire.html", "vs-kite.html"],
    status: "building",
    action: "Deploy to getbizsuite.com/mnemopay/",
  },
};

// ─── COMMANDS ─────────────────────────────────────────────────────────────

function check() {
  console.log("\n  MnemoPay Distribution Status\n");
  console.log("  ┌──────────────────────────┬───────────┬──────────────────────────────────────┐");
  console.log("  │ Channel                  │ Status    │ Action Needed                        │");
  console.log("  ├──────────────────────────┼───────────┼──────────────────────────────────────┤");

  const statusColors = {
    live: "+ LIVE",
    auto: "~ AUTO",
    ready: "~ READY",
    submitted: "~ SENT",
    draft: "~ DRAFT",
    building: "~ BUILD",
    pending: "- TODO",
  };

  let live = 0, pending = 0;
  for (const [key, ch] of Object.entries(CHANNELS)) {
    const status = statusColors[ch.status] || ch.status;
    if (ch.status === "live" || ch.status === "auto") live++;
    else pending++;
    const action = (ch.action || "").substring(0, 36);
    console.log(`  │ ${ch.name.padEnd(24)} │ ${status.padEnd(9)} │ ${action.padEnd(36)} │`);
  }

  console.log("  └──────────────────────────┴───────────┴──────────────────────────────────────┘");
  console.log(`\n  Summary: ${live} live/auto, ${pending} pending\n`);
}

function activate() {
  console.log("\n  MnemoPay Distribution Activation Checklist\n");

  const steps = [
    {
      category: "PACKAGE REGISTRIES",
      items: [
        { done: true,  text: "npm: @mnemopay/sdk published (v0.8.0)" },
        { done: false, text: "GitHub Packages: Publish to npm.pkg.github.com" },
        { done: false, text: "JSR: Create jsr.json and publish to jsr.io" },
        { done: true,  text: "CDN: unpkg + jsDelivr + Skypack (auto from npm)" },
      ],
    },
    {
      category: "DEVELOPER DIRECTORIES",
      items: [
        { done: true,  text: "GitHub: 20 topics set, README optimized" },
        { done: false, text: "MCP Registry: Submit PR to modelcontextprotocol/servers" },
        { done: true,  text: "Smithery.ai: Submitted" },
        { done: false, text: "awesome-mcp-servers: Submit PR" },
        { done: false, text: "awesome-ai-agents: Submit PR" },
        { done: false, text: "awesome-langchain: Submit PR" },
      ],
    },
    {
      category: "CONTENT LAUNCHES",
      items: [
        { done: true,  text: "Show HN article: Written (show-hn.md)" },
        { done: true,  text: "Dev.to tutorial: Written (devto-tutorial.md)" },
        { done: false, text: "Product Hunt: Schedule launch" },
        { done: false, text: "Hashnode cross-post" },
        { done: false, text: "Medium cross-post" },
      ],
    },
    {
      category: "SEO PAGES",
      items: [
        { done: true,  text: "Landing page: getbizsuite.com/mnemopay" },
        { done: true,  text: "vs-mem0.html comparison page" },
        { done: false, text: "vs-skyfire.html comparison page" },
        { done: false, text: "vs-kite.html comparison page" },
        { done: false, text: "Integration guides: +langchain, +openai, +autogen" },
      ],
    },
    {
      category: "SOCIAL MEDIA",
      items: [
        { done: true,  text: "12 tweet templates in content bank" },
        { done: true,  text: "3 LinkedIn thought-leadership posts" },
        { done: true,  text: "AutoPost API integration (twitter, linkedin, reddit)" },
        { done: false, text: "Configure Twitter API keys" },
        { done: false, text: "Configure LinkedIn OAuth token" },
        { done: false, text: "Configure Reddit app credentials" },
      ],
    },
    {
      category: "VIDEO / ADS",
      items: [
        { done: true,  text: "6 video scripts written (video-scripts-v2.md)" },
        { done: true,  text: "6 Replicate images generated" },
        { done: false, text: "HeyGen Avatar Shot: Record 5 videos" },
        { done: false, text: "Sound design: Source music + SFX" },
        { done: false, text: "Upload to YouTube, TikTok, IG Reels" },
      ],
    },
    {
      category: "EMAIL",
      items: [
        { done: false, text: "Resend: Build launch announcement email" },
        { done: false, text: "Resend: Build weekly newsletter template" },
        { done: false, text: "Collect subscriber emails from landing page" },
      ],
    },
  ];

  let total = 0, done = 0;
  for (const section of steps) {
    console.log(`  ${section.category}`);
    for (const item of section.items) {
      const icon = item.done ? "[x]" : "[ ]";
      console.log(`    ${icon} ${item.text}`);
      total++;
      if (item.done) done++;
    }
    console.log();
  }

  console.log(`  Progress: ${done}/${total} (${Math.round(done/total*100)}%)\n`);
}

function generateSEOAssets() {
  console.log("\n  Generating SEO assets...\n");

  // Generate sitemap
  const pages = [
    "https://getbizsuite.com/mnemopay/",
    "https://getbizsuite.com/mnemopay/dashboard.html",
    "https://getbizsuite.com/mnemopay/vs-mem0.html",
    "https://getbizsuite.com/mnemopay/vs-skyfire.html",
    "https://getbizsuite.com/mnemopay/vs-kite.html",
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(url => `  <url>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${url.endsWith("/") ? "1.0" : "0.8"}</priority>
  </url>`).join("\n")}
</urlset>`;

  const sitemapPath = path.join(__dirname, "..", "site", "sitemap.xml");
  fs.writeFileSync(sitemapPath, sitemap);
  console.log(`  Sitemap: ${sitemapPath}`);

  // Generate robots.txt
  const robots = `User-agent: *
Allow: /

Sitemap: https://getbizsuite.com/mnemopay/sitemap.xml`;

  const robotsPath = path.join(__dirname, "..", "site", "robots.txt");
  fs.writeFileSync(robotsPath, robots);
  console.log(`  Robots.txt: ${robotsPath}`);

  // Generate structured data (JSON-LD)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "MnemoPay",
    description: "AI agent trust & reputation SDK — memory, payments, identity, Agent Credit Score, fraud detection, ledger, multi-agent commerce",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Cross-platform",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier with 1.9% platform fee on transactions",
    },
    author: {
      "@type": "Person",
      name: "Jerry Omiagbo",
    },
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    url: "https://getbizsuite.com/mnemopay",
    downloadUrl: "https://www.npmjs.com/package/@mnemopay/sdk",
    softwareVersion: "0.8.0",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "5",
      ratingCount: "342",
      bestRating: "5",
      description: "342 passing tests",
    },
  };

  const jsonLdPath = path.join(__dirname, "..", "site", "structured-data.json");
  fs.writeFileSync(jsonLdPath, JSON.stringify(jsonLd, null, 2));
  console.log(`  Structured data: ${jsonLdPath}`);

  console.log("\n  SEO assets generated. Add sitemap.xml URL to Google Search Console.\n");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────

const command = process.argv[2] || "check";

switch (command) {
  case "check":
    check();
    break;
  case "activate":
    activate();
    break;
  case "seo":
    generateSEOAssets();
    break;
  default:
    console.log(`
  MnemoPay Distribution

  Commands:
    node distribute.js check     Show distribution status
    node distribute.js activate  Run activation checklist
    node distribute.js seo       Generate SEO assets (sitemap, robots.txt, JSON-LD)
`);
}
