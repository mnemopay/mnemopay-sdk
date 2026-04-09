# DOT SBIR Phase I — GridStamp Spatial Evidence for Autonomous Fleets

**Program:** Department of Transportation (DOT) SBIR Phase I
**URL:** volpe.dot.gov/work-with-us/small-business-innovation-research-program
**Award:** Up to $200,000
**Window:** FY26 Feb-Apr 2026 (verify current cycle)
**Status:** DRAFT
**Entity:** J&B Enterprise LLC, a Texas LLC, d/b/a GridStamp

---

## Why GridStamp (not MnemoPay) fits DOT SBIR

DOT SBIR funds transportation-safety research. GridStamp's spatial proof-of-presence is directly on-topic:
- Autonomous vehicle incident attribution
- Drone delivery dispute evidence
- Commercial fleet position verification
- Insurance claim substantiation for AV/robotics

This is a near-perfect topic match.

## Innovation statement

GridStamp is the first cryptographic spatial receipt system for autonomous fleets — an SDK that produces tamper-evident, offline-verifiable proof of where an autonomous vehicle or delivery robot was at a specific moment, designed to hold up in insurance disputes, incident investigations, and regulatory audits.

The technical innovation: a multi-layer defense-in-depth evidence format combining HMAC-signed camera frames, Merkle-rooted spatial memory, SSIM/LPIPS/depth-based proof-of-location, and active anti-spoof detection (replay, adversarial patches, depth injection, GPS spoofing). Every receipt is ~8KB and verifiable in ~4ms with no dependency on GridStamp's servers.

## Technical objectives (Phase I, 6 months)

1. **Objective 1:** Formalize the evidence-admissibility criteria for spatial receipts in at least 2 US jurisdictions. Partner with a transportation law clinic to scope what "admissible" means and identify gaps in GridStamp's current receipt format.
2. **Objective 2:** Run a 10-fleet, 30-day real-world pilot with at least one commercial operator (Serve Robotics, Coco Robotics, or a drone delivery company) and measure dispute-resolution time improvement.
3. **Objective 3:** Build a public "GridStamp Verifier" reference implementation — an offline CLI tool that any investigator (law enforcement, insurance adjuster, NTSB) can download and use to verify a receipt with no GridStamp-side cooperation.

## Proof of technical readiness

- GridStamp v1.0.1 is live on npm today
- 221 tests passing
- 92-day simulation with 5,500 agents across 20 fleets and 8 cities (14.5M operations, 91% spoof detection)
- Open source under Apache 2.0 at github.com/mnemopay/gridstamp

## Commercialization path

Post-Phase-I, the direct commercialization path is paid pilots with:
- **Insurance carriers** (Lloyd's Lab syndicates, Munich Re HSB — both have outreach drafts in this repo)
- **AV operators** (Waymo, Zoox, Cruise — smaller chance, but worth trying)
- **Delivery robotics** (Starship, Serve, Coco)
- **Commercial drone operators** (Zipline, DroneUp)

## Team

Jerry Omiagbo — Founder, Lead Engineer. Sole developer on GridStamp v0.1 through v1.0.1. 10+ years full-stack experience, prior work includes MnemoPay (separate d/b/a, also shipping) and BizSuite.

---

## Submission checklist

- [ ] Confirm current DOT SBIR FY26 solicitation topic list — verify spatial-receipts fits an open topic
- [ ] SAM.gov registration active for J&B Enterprise LLC
- [ ] Project narrative (15 pages max, FY26 template)
- [ ] Budget narrative
- [ ] Letter of support from a pilot customer (chase one after Lloyd's Lab or Munich Re HSB responds)
- [ ] Commercialization plan (re-use the gridstamp/gtm/focus.md + buyer-sheets content)
