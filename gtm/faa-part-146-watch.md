# FAA Part 146 ADSP — Regulatory Watch

**Status:** Pre-publication. Expected mid-2026.
**Last updated:** 2026-04-12
**Owner:** Jerry Omiagbo (jerry@getbizsuite.com)
**Relevance:** GridStamp's core value proposition depends on this rule becoming mandatory.

---

## What is FAA Part 146?

FAA Part 146 is the proposed **Automated Drone Surveillance and Presence (ADSP)** rule that will require cryptographically verifiable location records for all commercial BVLOS (Beyond Visual Line of Sight) drone operations.

Once enacted, every BVLOS operator will need:
- Tamper-proof, timestamped flight logs
- Cryptographic proof-of-presence at each waypoint
- Audit trails acceptable to FAA inspectors and insurers

GridStamp provides exactly this — Ed25519-signed, Merkle-chained proof-of-presence records — in 3 lines of code.

---

## Key Milestones to Watch

| Date | Event | Action |
|------|-------|--------|
| Mid-2026 (est.) | FAA publishes Part 146 NPRM (Notice of Proposed Rulemaking) | Blog post + press release: "GridStamp is ready" |
| After NPRM | 60-day public comment period | Submit comment as J&B Enterprise LLC citing GridStamp compliance |
| 6-12 months post-NPRM | Final rule published in Federal Register | Update GridStamp README with "FAA Part 146 compliant" badge |
| Implementation date (TBD) | Operators must comply | All Wing/Zipline/Amazon Prime Air operators need GridStamp or equivalent |

---

## Where to Monitor

1. **FAA Rulemaking Docket**: https://www.regulations.gov — search "FAA-2024" + "ADSP" or "BVLOS"
2. **FAA BEYOND Program updates**: https://www.faa.gov/uas/programs_partnerships/beyond
3. **AUVSI**: https://www.auvsi.org — industry association, gets early notice of NPRM
4. **GUTMA (Global UTM Association)**: https://gutma.org — international equivalent
5. **FAA official rulemaking**: https://www.faa.gov/regulations_policies/rulemaking/recently_published

---

## Competitive Context

- **Horkos.eu** — currently ranking for "EU AI Act compliance SDK" (analogous EU regulation). Monitor for drone compliance overlap.
- **EU U-Space Regulation** (already enacted) — requires equivalent digital flight records for EU BVLOS operators. GridStamp is already compliant.
- No current npm package occupies "drone proof of presence" keyword space.

---

## GridStamp Current Status

- npm: `gridstamp` (Apache 2.0)
- Site: https://getbizsuite.com/gridstamp.html
- Tests: 221 passing
- Cold outreach sent: Wing Aviation (partnerships@wing.com), Embention (info@embention.com)
- NSF SBIR pitch drafted: `gtm/nsf-sbir-project-pitch.md`

---

## Action Items When NPRM Publishes

1. Update gridstamp README + npm description: "FAA Part 146 ADSP compliant"
2. Write blog post: "GridStamp and the new FAA BVLOS compliance requirement"
3. Reach out to all Wing/Zipline/Amazon Prime Air contacts
4. Update BizSuite AI Audit pitch to include drone operators as target vertical
5. Submit public comment on docket supporting cryptographic standards
