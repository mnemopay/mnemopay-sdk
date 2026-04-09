# "The Math" — CapCut Assembly Guide

## Timeline Layout (60 seconds)

Open CapCut (free, capcut.com or desktop app). Create new project: 1920x1080, 30fps.

---

### AUDIO TRACKS (add first, everything else syncs to audio)

**Track 1 — Voiceover:** Drop "the-math-full.mp3" on the main audio track
**Track 2 — Music:** Drop Suno ambient bed underneath (see music section below)
  - Set music volume to 15-20% while voiceover plays
  - Swell to 40% during pauses and transitions
  - Full volume on end card

---

### VIDEO TIMELINE

```
0:00-0:03  [B1: City skyline establishing shot — Kling]
           Slow fade in from black. Sets the mood.

0:03-0:12  [TALKING HEAD — Hedra]
           "In 1494, a Franciscan monk..."
           INTERCUT with [B2: Ancient ledger close-up] at 0:05-0:07

0:12-0:22  [TALKING HEAD — Hedra]  
           "Five hundred and thirty-two years later..."
           Cut to talking head walking. Slight slow-mo zoom on "not a single one"

0:22-0:28  [TALKING HEAD — Hedra]
           "We built MnemoPay. Double-entry bookkeeping..."
           INTERCUT with [B3: Holographic dashboard] at 0:24-0:26
           INTERCUT with [B6: Code + green checkmarks] at 0:26-0:28

0:28-0:32  [TALKING HEAD — Hedra]
           "Fee plus net equals gross. Every. Single. Time."
           Slight smile. Hold on face. Let it breathe.

0:32-0:38  [TALKING HEAD — Hedra]
           "But that's just the ledger. We gave agents memory..."
           INTERCUT with [B4: Neural pathways firing] at 0:34-0:37

0:38-0:44  [TALKING HEAD — Hedra]
           "Memory that decays when it should. Strengthens when it matters."
           Direct to camera. No B-roll here — let the face sell it.

0:44-0:50  [TALKING HEAD — Hedra]
           "Six companies have raised eighty-seven million dollars..."
           CUT TO [B5: Competitor comparison card — CapCut graphic]
           Animate: each competitor fades in left, "MnemoPay $0" punches in right

0:50-0:56  [TALKING HEAD — Hedra]
           "We built all six layers. On zero funding."
           Leans in. This is the power moment. HOLD on the face.
           
0:56-1:00  [END CARD — CapCut graphic]
           Cut to black → fade in:
           Line 1: "MnemoPay" (large, white, clean font)
           Line 2: "The agent banking platform." (smaller, grey)
           Line 3: "14 modules. Zero penny drift." (smallest, accent color)
           Line 4: "getbizsuite.com/mnemopay" (blue link color)
           Music swells to 40% then fades
```

---

### TEXT OVERLAYS (add in CapCut)

These appear as subtle lower-thirds or center text during key moments:

| Timestamp | Text | Style |
|-----------|------|-------|
| 0:05 | "1494" | Large, serif font, fade in/out |
| 0:24 | "Double-Entry Ledger" | Clean sans-serif, lower-third |
| 0:27 | "1,000 random transactions" | Monospace, green accent |
| 0:28 | "fee + net = gross ✓" | Monospace, green on dark |
| 0:35 | "Cognitive Memory" | Clean, with neural icon |
| 0:36 | "Ebbinghaus + Hebbian" | Smaller, italic subtitle |
| 0:45 | "$87M+ raised" | Bold, slides in from left |
| 0:52 | "$0 funding" | Bold, punches center, slight shake |
| 0:58 | "npm install @mnemopay/sdk" | Monospace, terminal-style green text |

---

### TRANSITIONS

- **0:00 → 0:03:** Fade from black (1.5s)
- **Talking head ↔ B-roll:** Hard cuts (no dissolves — keeps energy up)
- **0:50 → end card:** 0.5s dissolve to black, then end card fades in
- **End card → out:** Fade to black (1s)

Do NOT overuse transitions. Hard cuts are more cinematic. The only dissolves are in/out of the piece.

---

### CAPTIONS (required — 80% of social video watched on mute)

CapCut has auto-captions:
1. Click "Text" → "Auto captions" → select audio track
2. Style: White text, black semi-transparent background
3. Font: Clean sans-serif (Inter, Helvetica, or CapCut's "Modern" preset)
4. Position: Bottom center, ~15% from bottom edge
5. Size: Large enough to read on mobile (at least 38pt for 1080p)
6. Bold key words: "1494", "MnemoPay", "$87 million", "zero", "six layers"

---

## SUNO MUSIC BED

Go to suno.com. Generate with this prompt:

**Prompt:** "minimal dark ambient electronic, 90 bpm, cinematic tech startup ad, subtle sub bass pulse, crystalline digital textures, slow build, no vocals, professional production, Stripe/Linear aesthetic"

**Tags:** ambient, electronic, cinematic, minimal, dark

**Duration:** Generate a 2-minute version, trim to 60s in CapCut.

**Mixing guide:**
- 0:00-0:03 — Music at 35% (establishing shot, no voice yet)
- 0:03-0:50 — Drop to 15% under voiceover
- At each pause/transition — briefly swell to 25%
- 0:28 "Every. Single. Time." — slight bass hit (find one on Freesound.org if Suno doesn't have it)
- 0:50-0:56 — Still 15% under voice
- 0:56-1:00 — Swell to 40% on end card, then fade

---

## EXPORT SETTINGS

### For YouTube / LinkedIn (horizontal):
- Resolution: 1920x1080
- Frame rate: 30fps
- Format: MP4 / H.264
- Bitrate: 10-15 Mbps

### For Reels / Shorts / TikTok (vertical):
- Resolution: 1080x1920
- Same settings
- Re-frame: talking head centered, B-roll cropped to portrait
- Captions may need repositioning

---

## COLOR GRADING (optional, DaVinci Resolve)

If you want that extra 10% polish:
1. Import the CapCut export into DaVinci Resolve (free)
2. Go to Color page
3. Apply: slight teal shadows + warm highlights (the "fintech" look)
4. Lift blacks slightly (never crush to pure black — adds that premium feel)
5. Add subtle film grain (Resolve has built-in grain generators)
6. Export

This step is optional. CapCut's output is already good enough for social.

---

## PRODUCTION CHECKLIST

- [ ] Voice sample recorded (30-60 sec, natural speaking)
- [ ] ElevenLabs voice cloned (or use "Adam" default)
- [ ] run: node generate-voiceover.js
- [ ] Hedra account created (free at hedra.com)
- [ ] Talking head generated (ad-banking.png + audio)
- [ ] Kling B-roll: B1 city skyline
- [ ] Kling B-roll: B2 ancient ledger
- [ ] Kling B-roll: B3 holographic dashboard
- [ ] Kling B-roll: B4 neural pathways
- [ ] Kling B-roll: B6 code + checkmarks
- [ ] Competitor card created in CapCut (B5)
- [ ] End card created in CapCut (B7)
- [ ] Suno music bed generated
- [ ] Assembled in CapCut (follow timeline above)
- [ ] Captions added
- [ ] Exported 1920x1080 (YouTube/LinkedIn)
- [ ] Exported 1080x1920 (Reels/Shorts/TikTok)
- [ ] Uploaded to YouTube, LinkedIn, IG, TikTok
