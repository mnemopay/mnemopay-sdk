#!/usr/bin/env node
/**
 * MnemoPay Video Ad — Voiceover Generator
 * Uses ElevenLabs API to generate narration from script
 *
 * Prerequisites:
 *   1. Go to elevenlabs.io/app/voice-lab
 *   2. Click "Add Generative or Cloned Voice" → "Instant Voice Clone"
 *   3. Upload a 30-60 second recording of yourself speaking naturally
 *   4. Name it "Jerry" and copy the voice_id
 *   5. Paste that voice_id below
 *
 * If you don't have a voice clone yet, the script uses "Adam" (deep, confident male)
 * which works well for tech ads. Replace VOICE_ID once you clone yours.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = 'sk_d9a94c07ff51e473baa07a29c81a77315e573eb637f2b777';

// Replace with your cloned voice ID once created
// To find it: elevenlabs.io/app/voice-lab → click your voice → copy ID from URL
// Default "Adam" = pNInz6obpgDQGcFmaJgB (deep, authoritative male)
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George — British, warm, captivating storyteller

const OUTPUT_DIR = path.join(__dirname, 'audio');

// "The Math" script — broken into segments for timing control
const SEGMENTS = [
  {
    id: '01-opening',
    text: 'In 1494, a Franciscan monk named Luca Pacioli published a book. It described a system where every debit has a credit. Every transaction balances. Every penny is accounted for.',
    timing: '0-12s',
    scene: 'Standing at penthouse windows, golden hour, city below',
    pause_after_ms: 800,
  },
  {
    id: '02-problem',
    text: 'Five hundred and thirty-two years later, we\'re building AI agents that can trade stocks, manage portfolios, close contracts worth millions. And not a single one of them uses Pacioli\'s system.',
    timing: '12-22s',
    scene: 'Turns from window, walks slowly, then stops',
    pause_after_ms: 600,
  },
  {
    id: '03-solution',
    text: 'We built MnemoPay. Double-entry bookkeeping for AI agents. We stress-tested it with a thousand random transactions. Fee plus net equals gross. Every. Single. Time.',
    timing: '22-32s',
    scene: 'Sits at desk, leans forward, slight smile',
    pause_after_ms: 400,
  },
  {
    id: '04-memory',
    text: 'But that\'s just the ledger. We gave agents memory. Not a key-value store. Actual cognitive memory. Backed by the same neuroscience that explains how your brain remembers your first kiss but forgets what you had for lunch. Memory that decays when it should. Strengthens when it matters.',
    timing: '32-44s',
    scene: 'Stands, walks, direct to camera',
    pause_after_ms: 600,
  },
  {
    id: '05-competition',
    text: 'Six companies have raised eighty-seven million dollars building pieces of this. Memory here. Payments there. None of them built both.',
    timing: '44-52s',
    scene: 'Beat, contemplative',
    pause_after_ms: 400,
  },
  {
    id: '06-close',
    text: 'We built all six layers. On zero funding.',
    timing: '52-56s',
    scene: 'Leans in slightly, direct eye contact',
    pause_after_ms: 0,
  },
];

// Full script as one piece (for single-take generation)
const FULL_SCRIPT = SEGMENTS.map(s => s.text).join(' ... ');

// ElevenLabs voice settings for "confident founder" delivery
const VOICE_SETTINGS = {
  stability: 0.45,          // Lower = more expressive, higher = more consistent
  similarity_boost: 0.78,   // High similarity to cloned voice
  style: 0.35,              // Some stylistic variation
  use_speaker_boost: true,  // Clarity boost
};

function generateAudio(text, filename) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: VOICE_SETTINGS,
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => reject(new Error(`ElevenLabs ${res.statusCode}: ${data}`)));
        return;
      }

      const outPath = path.join(OUTPUT_DIR, filename);
      const file = fs.createWriteStream(outPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(outPath);
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('MnemoPay "The Math" — Voiceover Generator');
  console.log('==========================================\n');

  // Option 1: Generate full script as single take
  console.log('[1/2] Generating full voiceover (single take)...');
  try {
    const fullPath = await generateAudio(FULL_SCRIPT, 'the-math-full.mp3');
    console.log(`  Done: ${fullPath}`);
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  await sleep(2000); // Rate limit buffer

  // Option 2: Generate each segment separately (for precise editing)
  console.log('\n[2/2] Generating individual segments...\n');

  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i];
    console.log(`  [${i + 1}/${SEGMENTS.length}] ${seg.id} (${seg.timing})`);

    try {
      const segPath = await generateAudio(seg.text, `${seg.id}.mp3`);
      console.log(`    Done: ${segPath}`);
    } catch (err) {
      console.log(`    Error: ${err.message}`);
    }

    if (i < SEGMENTS.length - 1) {
      await sleep(1500); // Rate limit between segments
    }
  }

  console.log('\n==========================================');
  console.log('Audio files saved to: ' + OUTPUT_DIR);
  console.log('\nNext steps:');
  console.log('  1. Upload ad-banking.png to Hedra (hedra.com)');
  console.log('  2. Upload the-math-full.mp3 as the audio');
  console.log('  3. Generate talking head video');
  console.log('  4. Use Kling for B-roll shots (see SHOT-LIST.md)');
  console.log('  5. Assemble in CapCut (see ASSEMBLY-GUIDE.md)');
}

main();
