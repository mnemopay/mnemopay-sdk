// One-off quote-tweet helper. Reply was blocked by author's reply-controls,
// so we quote-tweet instead. Cost: $0.20 per owned-account write with URL.
import crypto from "crypto";
import "dotenv/config";

function oauthHeader(method, url) {
  const key = process.env.TWITTER_API_KEY;
  const secret = process.env.TWITTER_API_SECRET;
  const token = process.env.TWITTER_ACCESS_TOKEN;
  const tokenSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!key || !secret || !token || !tokenSecret) throw new Error("Twitter creds missing");
  const oauth = {
    oauth_consumer_key: key,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_token: token,
    oauth_version: "1.0",
  };
  const base =
    method +
    "&" +
    encodeURIComponent(url) +
    "&" +
    encodeURIComponent(
      Object.keys(oauth)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(oauth[k])}`)
        .join("&")
    );
  const signingKey = encodeURIComponent(secret) + "&" + encodeURIComponent(tokenSecret);
  const signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
      .join(", ")
  );
}

const text = process.argv[2];
const quotedId = process.argv[3];
if (!text || !quotedId) {
  console.error("usage: node _quote_once.js \"<text>\" <quoted_tweet_id>");
  process.exit(1);
}

const url = "https://api.twitter.com/2/tweets";
const auth = oauthHeader("POST", url);
const body = { text, quote_tweet_id: String(quotedId) };
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await res.json();
if (!res.ok) {
  console.error("FAILED:", JSON.stringify(data));
  process.exit(2);
}
console.log("POSTED:", `https://x.com/atalldarkman/status/${data.data.id}`);
