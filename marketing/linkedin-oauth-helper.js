#!/usr/bin/env node
/**
 * LinkedIn OAuth 2.0 helper — unblocks autopost.js LinkedIn posting.
 *
 * LinkedIn requires Community Management API access (approved via Developer portal):
 *   https://www.linkedin.com/developers/
 *
 * Step 1 — Create a LinkedIn app if you don't have one:
 *   - Go to https://www.linkedin.com/developers/apps/new
 *   - Add products: "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect"
 *   - In Auth tab, add redirect URL: http://localhost:3939/callback
 *
 * Step 2 — Set env vars:
 *   LINKEDIN_CLIENT_ID=<from your LinkedIn app>
 *   LINKEDIN_CLIENT_SECRET=<from your LinkedIn app>
 *
 * Step 3 — Run this script:
 *   node linkedin-oauth-helper.js
 *
 * It will:
 *   1. Print an auth URL for you to visit (browser)
 *   2. LinkedIn redirects to http://localhost:3939/callback with ?code=...
 *   3. This script exchanges the code for an access token
 *   4. Token is written to .env.linkedin in this directory
 *   5. autopost.js reads LINKEDIN_ACCESS_TOKEN from that file
 *
 * Token lifetime: 60 days (refresh by re-running this script).
 */
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, ".env.linkedin");

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3939/callback";
// Scopes for posting on your own profile and reading basic profile info.
const SCOPES = ["openid", "profile", "email", "w_member_social"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET env vars.");
  console.error("Create a LinkedIn app first: https://www.linkedin.com/developers/apps/new");
  console.error("Then re-run with:");
  console.error("  LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... node linkedin-oauth-helper.js");
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");
const authUrl =
  "https://www.linkedin.com/oauth/v2/authorization?" +
  new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: SCOPES.join(" "),
  }).toString();

console.log("\n  LinkedIn OAuth — grant access\n");
console.log("  1. Open this URL in your browser:");
console.log(`\n     ${authUrl}\n`);
console.log("  2. Approve the app. LinkedIn will redirect to localhost.");
console.log("  3. This script will capture the code and fetch your token.\n");

// Try to open the URL automatically on Windows.
const opener = process.platform === "win32" ? `start "" "${authUrl}"` :
               process.platform === "darwin" ? `open "${authUrl}"` :
               `xdg-open "${authUrl}"`;
exec(opener, () => {});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>LinkedIn returned error: ${error}</h2><p>${url.searchParams.get("error_description") || ""}</p>`);
    console.error(`\n  Error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (returnedState !== state) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>State mismatch. Possible CSRF.</h2>");
    console.error("\n  State mismatch. Aborting.");
    server.close();
    process.exit(1);
  }

  try {
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(data)}`);
    }

    const token = data.access_token;
    const expiresIn = data.expires_in;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const envContent = `LINKEDIN_ACCESS_TOKEN=${token}\nLINKEDIN_TOKEN_EXPIRES_AT=${expiresAt}\n`;
    fs.writeFileSync(ENV_FILE, envContent);

    // Also fetch the user ID (needed for /ugcPosts author URN).
    try {
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        fs.appendFileSync(ENV_FILE, `LINKEDIN_USER_ID=${profile.sub}\n`);
        console.log(`\n  Profile: ${profile.name} (${profile.sub})`);
      }
    } catch {}

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <div style="font-family:system-ui;max-width:600px;margin:60px auto;padding:40px;border-radius:12px;background:#f0fdf4;border:1px solid #86efac">
        <h2 style="color:#166534">LinkedIn connected</h2>
        <p>Token saved to <code>marketing/.env.linkedin</code>. Expires ${expiresAt}.</p>
        <p>You can close this tab.</p>
      </div>
    `);

    console.log(`\n  Token saved to ${ENV_FILE}`);
    console.log(`  Expires: ${expiresAt}`);
    console.log("\n  To use in autopost.js, load the env file before running:");
    console.log("    source marketing/.env.linkedin && node marketing/autopost.js linkedin \"Title\" \"Body\"");
    console.log("\n  Or on Windows (cmd):");
    console.log("    for /f \"tokens=*\" %i in (marketing\\.env.linkedin) do set %i");

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><pre>${err.message}</pre>`);
    console.error(`\n  ${err.message}`);
    server.close();
    process.exit(1);
  }
});

server.listen(3939, () => {
  console.log("  Listening on http://localhost:3939/callback ...");
});
