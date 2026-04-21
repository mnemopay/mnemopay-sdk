import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOG_FILES = [
  join(__dirname, "mcp-partner-log.json"),
  join(__dirname, "data", "drip-log.json"),
  join(__dirname, "..", "..", "Desktop", "Email Outreach", "day3-send-log.json"),
  join(__dirname, "..", "..", "Desktop", "Email Outreach", "day7-send-log.json"),
  join(__dirname, "..", "..", "Desktop", "Email Outreach", "mnemopay-b2b-log.json"),
  join(__dirname, "..", "..", "Desktop", "Email Outreach", "resend-fix-45-log.json"),
];

const SUPPRESSION_FILE = join(__dirname, "data", "suppression.json");

export function getRecentlySent(withinDays = 3) {
  const cutoff = Date.now() - withinDays * 86400000;
  const sent = new Map();

  for (const logFile of LOG_FILES) {
    if (!existsSync(logFile)) continue;
    try {
      const data = JSON.parse(readFileSync(logFile, "utf8"));
      const entries = Array.isArray(data) ? data : Object.values(data);
      for (const entry of entries) {
        const email = entry.to || entry.email || entry.recipient;
        const date = entry.sentAt || entry.sent || entry.date || entry.timestamp;
        if (!email) continue;
        const ts = date ? new Date(date).getTime() : 0;
        if (ts > cutoff || !date) {
          sent.set(email.toLowerCase(), { date: date || "unknown", source: logFile.split(/[/\\]/).pop() });
        }
      }
    } catch {}
  }

  return sent;
}

export function getSuppressed() {
  if (!existsSync(SUPPRESSION_FILE)) return new Set();
  try {
    const data = JSON.parse(readFileSync(SUPPRESSION_FILE, "utf8"));
    return new Set((Array.isArray(data) ? data : []).map((e) => e.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function filterEmails(emails, { dedupeWindowDays = 3, verbose = true } = {}) {
  const recentlySent = getRecentlySent(dedupeWindowDays);
  const suppressed = getSuppressed();
  const passed = [];
  const skipped = [];

  for (const email of emails) {
    const addr = (email.to || "").toLowerCase();
    if (suppressed.has(addr)) {
      skipped.push({ ...email, reason: "suppressed" });
      if (verbose) console.log(`[SKIP] ${addr} — on suppression list`);
    } else if (recentlySent.has(addr)) {
      const info = recentlySent.get(addr);
      skipped.push({ ...email, reason: `sent ${info.date} via ${info.source}` });
      if (verbose) console.log(`[SKIP] ${addr} — already sent ${info.date} (${info.source})`);
    } else {
      passed.push(email);
    }
  }

  if (verbose && skipped.length > 0) {
    console.log(`\n${skipped.length} skipped, ${passed.length} will send\n`);
  }

  return { passed, skipped };
}
