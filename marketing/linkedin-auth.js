#!/usr/bin/env node
/**
 * LinkedIn OAuth 2.0 Authorization Code Flow
 *
 * Handles the full lifecycle:
 *   1. Opens browser for LinkedIn authorization
 *   2. Exchanges authorization code for access + refresh tokens
 *   3. Saves tokens to data/linkedin-token.json with expiry tracking
 *   4. Provides token refresh when access token nears expiry
 *
 * Prerequisites:
 *   - Create a LinkedIn Developer App: https://www.linkedin.com/developers/apps/new
 *   - Add products: "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect"
 *   - In Auth tab, add redirect URL: http://localhost:3456/callback
 *   - Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env
 *
 * Usage:
 *   node linkedin-auth.js              — Start OAuth flow (opens browser)
 *   node linkedin-auth.js refresh      — Refresh an existing token
 *   node linkedin-auth.js status       — Check token validity
 *
 * Token lifetime:
 *   Access token:  60 days
 *   Refresh token: 365 days
 */

import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, "data", "linkedin-token.json");
const ENV_FILE = path.join(__dirname, "..", ".env");

// Ensure data dir exists
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── Config ──────────────────────────────────────────────────────────────────

// Load .env manually (zero-dependency)
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = val;
  }
}
loadEnv();

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3456/callback";
const SCOPES = ["openid", "profile", "w_member_social"];
const PORT = 3456;

// How many seconds before expiry to consider the token "near expiry"
const REFRESH_BUFFER_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ─── Token Management ────────────────────────────────────────────────────────

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveToken(tokenData) {
  const record = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_in: tokenData.expires_in,
    refresh_token_expires_in: tokenData.refresh_token_expires_in || null,
    access_token_expires_at: new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString(),
    refresh_token_expires_at: tokenData.refresh_token_expires_in
      ? new Date(
          Date.now() + tokenData.refresh_token_expires_in * 1000
        ).toISOString()
      : null,
    person_urn: tokenData.person_urn || null,
    profile_name: tokenData.profile_name || null,
    obtained_at: new Date().toISOString(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(record, null, 2));
  return record;
}

function isTokenExpired(token) {
  if (!token || !token.access_token_expires_at) return true;
  return new Date(token.access_token_expires_at) <= new Date();
}

function isTokenNearExpiry(token) {
  if (!token || !token.access_token_expires_at) return true;
  const expiresAt = new Date(token.access_token_expires_at).getTime();
  return expiresAt - Date.now() < REFRESH_BUFFER_SECONDS * 1000;
}

function isRefreshTokenValid(token) {
  if (!token || !token.refresh_token) return false;
  if (!token.refresh_token_expires_at) return true; // no expiry tracked, assume valid
  return new Date(token.refresh_token_expires_at) > new Date();
}

// ─── API Calls ───────────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
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

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${JSON.stringify(data)}`
    );
  }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (${res.status}): ${JSON.stringify(data)}`
    );
  }
  return data;
}

async function fetchProfile(accessToken) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// ─── OAuth Flow (HTTP Server) ────────────────────────────────────────────────

function startOAuthFlow() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(`
  Missing LinkedIn credentials.

  1. Create an app at https://www.linkedin.com/developers/apps/new
  2. Add these to your .env:

     LINKEDIN_CLIENT_ID=your_client_id
     LINKEDIN_CLIENT_SECRET=your_client_secret

  3. In the app's Auth tab, add this redirect URL:
     ${REDIRECT_URI}
`);
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

  console.log(`
  LinkedIn OAuth 2.0 — Authorization

  1. A browser window will open (or copy the URL below).
  2. Approve the app on LinkedIn.
  3. You'll be redirected back here automatically.

  URL: ${authUrl}
`);

  // Open browser
  const opener =
    process.platform === "win32"
      ? `start "" "${authUrl}"`
      : process.platform === "darwin"
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(opener, () => {});

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description") || "";

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlPage("Error", `LinkedIn returned: ${error} — ${errorDesc}`, true));
      console.error(`  Error: ${error} — ${errorDesc}`);
      server.close();
      process.exit(1);
    }

    if (returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlPage("Error", "State mismatch. Possible CSRF attack.", true));
      console.error("  State mismatch. Aborting.");
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlPage("Error", "No authorization code received.", true));
      console.error("  No authorization code received.");
      server.close();
      process.exit(1);
    }

    try {
      console.log("  Exchanging code for tokens...");
      const tokenData = await exchangeCodeForToken(code);

      // Fetch profile to get person URN
      const profile = await fetchProfile(tokenData.access_token);
      if (profile) {
        tokenData.person_urn = `urn:li:person:${profile.sub}`;
        tokenData.profile_name = profile.name;
      }

      const saved = saveToken(tokenData);

      const expiryDate = new Date(saved.access_token_expires_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        htmlPage(
          "LinkedIn Connected",
          `<p>Token saved to <code>marketing/data/linkedin-token.json</code></p>
           <p>Profile: <strong>${saved.profile_name || "Unknown"}</strong></p>
           <p>Access token expires: <strong>${expiryDate}</strong></p>
           ${saved.refresh_token ? "<p>Refresh token saved for auto-renewal.</p>" : "<p>No refresh token received (normal for first auth).</p>"}
           <p>You can close this tab.</p>`,
          false
        )
      );

      console.log(`
  Token saved to ${TOKEN_FILE}

  Profile:       ${saved.profile_name || "Unknown"}
  Person URN:    ${saved.person_urn || "Unknown"}
  Access token:  expires ${saved.access_token_expires_at}
  Refresh token: ${saved.refresh_token ? "yes (expires " + saved.refresh_token_expires_at + ")" : "none"}

  autopost.js will automatically load this token.
`);

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(htmlPage("Error", `Token exchange failed: ${err.message}`, true));
      console.error(`  ${err.message}`);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`  Listening on http://localhost:${PORT}/callback ...\n`);
  });
}

// ─── Refresh Command ─────────────────────────────────────────────────────────

async function handleRefresh() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("  Missing LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET in .env");
    process.exit(1);
  }

  const token = loadToken();
  if (!token) {
    console.error("  No token file found. Run: node linkedin-auth.js");
    process.exit(1);
  }

  if (!token.refresh_token) {
    console.error("  No refresh token available. Re-run: node linkedin-auth.js");
    process.exit(1);
  }

  if (!isRefreshTokenValid(token)) {
    console.error("  Refresh token has expired. Re-run: node linkedin-auth.js");
    process.exit(1);
  }

  try {
    console.log("  Refreshing access token...");
    const newTokenData = await refreshAccessToken(token.refresh_token);

    // Preserve person URN and profile name from previous token
    newTokenData.person_urn = token.person_urn;
    newTokenData.profile_name = token.profile_name;

    // If LinkedIn returned a new refresh token, use it; otherwise keep the old one
    if (!newTokenData.refresh_token) {
      newTokenData.refresh_token = token.refresh_token;
      newTokenData.refresh_token_expires_in = token.refresh_token_expires_at
        ? Math.floor((new Date(token.refresh_token_expires_at).getTime() - Date.now()) / 1000)
        : null;
    }

    const saved = saveToken(newTokenData);
    console.log(`
  Token refreshed successfully.

  Access token expires: ${saved.access_token_expires_at}
  Saved to: ${TOKEN_FILE}
`);
  } catch (err) {
    console.error(`  Refresh failed: ${err.message}`);
    console.error("  You may need to re-authorize: node linkedin-auth.js");
    process.exit(1);
  }
}

// ─── Status Command ──────────────────────────────────────────────────────────

function handleStatus() {
  const token = loadToken();
  if (!token) {
    console.log("\n  No LinkedIn token found. Run: node linkedin-auth.js\n");
    return;
  }

  const expired = isTokenExpired(token);
  const nearExpiry = isTokenNearExpiry(token);
  const refreshValid = isRefreshTokenValid(token);

  const daysLeft = token.access_token_expires_at
    ? Math.max(0, Math.floor((new Date(token.access_token_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  console.log(`
  LinkedIn Token Status
  ─────────────────────
  Profile:        ${token.profile_name || "Unknown"}
  Person URN:     ${token.person_urn || "Unknown"}
  Access token:   ${expired ? "EXPIRED" : nearExpiry ? `NEAR EXPIRY (${daysLeft} days left)` : `Valid (${daysLeft} days left)`}
  Expires at:     ${token.access_token_expires_at || "Unknown"}
  Refresh token:  ${token.refresh_token ? (refreshValid ? "Valid" : "EXPIRED") : "None"}
  Obtained at:    ${token.obtained_at || "Unknown"}

  ${expired ? "Run: node linkedin-auth.js refresh  (or re-authorize if refresh token expired)" : nearExpiry ? "Consider refreshing: node linkedin-auth.js refresh" : "Token is healthy."}
`);
}

// ─── Exported helper for autopost.js ─────────────────────────────────────────

/**
 * Get a valid LinkedIn access token.
 * Auto-refreshes if the token is near expiry and a refresh token is available.
 * Returns { access_token, person_urn } or throws.
 */
export async function getLinkedInToken() {
  // Load .env for CLIENT_ID / CLIENT_SECRET if not already loaded
  loadEnv();

  const token = loadToken();
  if (!token) {
    throw new Error("No LinkedIn token. Run: node marketing/linkedin-auth.js");
  }

  // If token is expired or near expiry, try to refresh
  if (isTokenNearExpiry(token) && token.refresh_token && isRefreshTokenValid(token)) {
    const cid = process.env.LINKEDIN_CLIENT_ID;
    const csecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (cid && csecret) {
      try {
        const newTokenData = await refreshAccessToken(token.refresh_token);
        newTokenData.person_urn = token.person_urn;
        newTokenData.profile_name = token.profile_name;
        if (!newTokenData.refresh_token) {
          newTokenData.refresh_token = token.refresh_token;
          newTokenData.refresh_token_expires_in = token.refresh_token_expires_at
            ? Math.floor((new Date(token.refresh_token_expires_at).getTime() - Date.now()) / 1000)
            : null;
        }
        const saved = saveToken(newTokenData);
        console.log(`  [LinkedIn] Token auto-refreshed. Expires: ${saved.access_token_expires_at}`);
        return { access_token: saved.access_token, person_urn: saved.person_urn };
      } catch (err) {
        console.warn(`  [LinkedIn] Auto-refresh failed: ${err.message}`);
        // Fall through — use existing token if not fully expired
      }
    }
  }

  if (isTokenExpired(token)) {
    throw new Error("LinkedIn token expired. Run: node marketing/linkedin-auth.js");
  }

  return { access_token: token.access_token, person_urn: token.person_urn };
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function htmlPage(title, body, isError) {
  const bg = isError ? "#fef2f2" : "#f0fdf4";
  const border = isError ? "#fca5a5" : "#86efac";
  const color = isError ? "#991b1b" : "#166534";
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:500px;padding:40px;border-radius:12px;background:${bg};border:1px solid ${border}">
    <h2 style="color:${color};margin-top:0">${title}</h2>
    ${body}
  </div>
</body></html>`;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const [, , command] = process.argv;

switch (command) {
  case "refresh":
    handleRefresh();
    break;
  case "status":
    handleStatus();
    break;
  default:
    startOAuthFlow();
    break;
}
