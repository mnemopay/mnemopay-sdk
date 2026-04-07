#!/usr/bin/env node
/**
 * MnemoPay Email Marketing — Resend API
 *
 * Launch announcement, weekly newsletter, and drip sequence.
 * Uses Resend free tier (3,000 emails/mo).
 *
 * Usage:
 *   node email-launch.js send-launch "email@example.com"
 *   node email-launch.js send-newsletter "email@example.com"
 *   node email-launch.js preview launch
 *   node email-launch.js preview newsletter
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "jerry@getbizsuite.com";

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────

const TEMPLATES = {
  launch: {
    subject: "MnemoPay is live — memory + payments for AI agents",
    html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 600px; margin: 0 auto; background: #07070d; color: #e8e8f0; padding: 40px 30px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="font-size: 24px; margin: 0;">Mnemo<span style="background: linear-gradient(135deg, #6c5ce7, #00cec9); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Pay</span></h1>
  </div>

  <h2 style="font-size: 20px; margin-bottom: 16px; color: #e8e8f0;">Your AI agent just got a wallet.</h2>

  <p style="color: #a0a0b8; line-height: 1.7; font-size: 15px;">
    MnemoPay gives any AI agent memory, payments, identity, and fraud detection in 5 lines of code.
  </p>

  <div style="background: #0e0e18; border: 1px solid #1c1c30; border-radius: 8px; padding: 20px; margin: 24px 0; font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.8; color: #00cec9;">
    npm install @mnemopay/sdk<br><br>
    <span style="color: #7a7a95;">const</span> agent = MnemoPay.quick(<span style="color: #e17055;">"my-agent"</span>);<br>
    <span style="color: #7a7a95;">await</span> agent.remember(<span style="color: #e17055;">"User prefers monthly billing"</span>);<br>
    <span style="color: #7a7a95;">const</span> tx = <span style="color: #7a7a95;">await</span> agent.charge(<span style="color: #00b894;">25</span>, <span style="color: #e17055;">"Monthly access"</span>);<br>
    <span style="color: #7a7a95;">await</span> agent.settle(tx.id);
  </div>

  <h3 style="font-size: 16px; color: #00cec9; margin: 24px 0 12px;">What's included:</h3>
  <ul style="color: #a0a0b8; line-height: 2; font-size: 14px; padding-left: 20px;">
    <li>Cognitive memory (Ebbinghaus + Hebbian reinforcement)</li>
    <li>Double-entry ledger (zero penny drift, always balanced)</li>
    <li>Escrow payments (Paystack, Stripe, Lightning)</li>
    <li>KYA identity + capability tokens</li>
    <li>Geo-enhanced fraud detection</li>
    <li>Multi-agent commerce (one call, both remember)</li>
  </ul>

  <p style="color: #a0a0b8; font-size: 14px; margin-top: 24px;">
    402 tests. 2,600+ tx/sec. MIT licensed. Free to start.
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="https://getbizsuite.com/mnemopay" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6c5ce7, #00cec9); color: white; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 15px;">Get Started Free</a>
  </div>

  <hr style="border: none; border-top: 1px solid #1c1c30; margin: 30px 0;">

  <p style="color: #555; font-size: 12px; text-align: center;">
    MnemoPay &copy; 2026 | <a href="https://getbizsuite.com/mnemopay" style="color: #6c5ce7;">Unsubscribe</a>
  </p>
</div>`,
  },

  newsletter: {
    subject: "MnemoPay Weekly — Agent economy updates",
    html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 600px; margin: 0 auto; background: #07070d; color: #e8e8f0; padding: 40px 30px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="font-size: 20px; margin: 0;">Mnemo<span style="background: linear-gradient(135deg, #6c5ce7, #00cec9); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Pay</span> Weekly</h1>
    <p style="color: #7a7a95; font-size: 13px;">Agent banking infrastructure updates</p>
  </div>

  <h2 style="font-size: 18px; margin-bottom: 16px;">This Week</h2>

  <div style="background: #0e0e18; border: 1px solid #1c1c30; border-radius: 8px; padding: 20px; margin: 16px 0;">
    <h3 style="font-size: 15px; color: #00cec9; margin: 0 0 8px;">What shipped</h3>
    <ul style="color: #a0a0b8; font-size: 14px; line-height: 1.8; padding-left: 20px;">
      <li>{{SHIPPED_ITEM_1}}</li>
      <li>{{SHIPPED_ITEM_2}}</li>
      <li>{{SHIPPED_ITEM_3}}</li>
    </ul>
  </div>

  <div style="background: #0e0e18; border: 1px solid #1c1c30; border-radius: 8px; padding: 20px; margin: 16px 0;">
    <h3 style="font-size: 15px; color: #6c5ce7; margin: 0 0 8px;">Industry signal</h3>
    <p style="color: #a0a0b8; font-size: 14px; line-height: 1.7;">{{INDUSTRY_NEWS}}</p>
  </div>

  <div style="background: #0e0e18; border: 1px solid #1c1c30; border-radius: 8px; padding: 20px; margin: 16px 0;">
    <h3 style="font-size: 15px; color: #00b894; margin: 0 0 8px;">Quick tip</h3>
    <p style="color: #a0a0b8; font-size: 14px; line-height: 1.7;">{{TIP}}</p>
  </div>

  <div style="text-align: center; margin: 32px 0;">
    <a href="https://getbizsuite.com/mnemopay" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #6c5ce7, #00cec9); color: white; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 14px;">View Dashboard</a>
  </div>

  <hr style="border: none; border-top: 1px solid #1c1c30; margin: 30px 0;">
  <p style="color: #555; font-size: 12px; text-align: center;">
    MnemoPay &copy; 2026 | <a href="https://getbizsuite.com/mnemopay" style="color: #6c5ce7;">Unsubscribe</a>
  </p>
</div>`,
  },
};

// ─── SEND VIA RESEND ──────────────────────────────────────────────────────

async function sendEmail(to, template) {
  if (!RESEND_API_KEY) {
    console.log("  RESEND_API_KEY not set. Preview mode only.");
    console.log(`\n  Subject: ${template.subject}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject: template.subject,
      html: template.html,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  console.log(`  Sent to ${to}: ${data.id}`);
  return data;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────

const [,, command, arg] = process.argv;

switch (command) {
  case "send-launch":
    if (!arg) { console.log("  Usage: node email-launch.js send-launch email@example.com"); break; }
    sendEmail(arg, TEMPLATES.launch).catch(e => console.error(e.message));
    break;

  case "send-newsletter":
    if (!arg) { console.log("  Usage: node email-launch.js send-newsletter email@example.com"); break; }
    sendEmail(arg, TEMPLATES.newsletter).catch(e => console.error(e.message));
    break;

  case "preview":
    const tmpl = TEMPLATES[arg];
    if (!tmpl) { console.log("  Templates: launch, newsletter"); break; }
    console.log(`\n  Subject: ${tmpl.subject}\n`);
    // Write HTML preview
    const previewPath = `${arg}-preview.html`;
    const fs = await import("fs");
    fs.writeFileSync(previewPath, tmpl.html);
    console.log(`  Preview saved: ${previewPath}`);
    console.log("  Open in browser to preview.\n");
    break;

  default:
    console.log(`
  MnemoPay Email Marketing (Resend)

  Commands:
    node email-launch.js send-launch "email"     Send launch announcement
    node email-launch.js send-newsletter "email"  Send weekly newsletter
    node email-launch.js preview launch           Preview launch email HTML
    node email-launch.js preview newsletter       Preview newsletter HTML
`);
}
