'use strict';
// VieNeu TTS adapter (sync) — server-side only. BACKUP voice provider.
//
// Verified API shape (see ~/workspace/custom-connectors/custom.vieneu/CONNECTOR.md
// and the helper vieneu.py, both checked against real calls on 2026-10-30/11-01):
//   POST https://api.vieneu.io/api/v1/audio/speech
//     {input, voice, engine: "v4", speed?, emotion?}  -> 200 + raw MP3 bytes
// Voice ids are Vietnamese display names, e.g. "Huyền Trang".
// Sync endpoint: one short sample took ~3.7s wall time on 2026-11-01, so it
// can serve live answers for short texts; long texts are split into
// sentence-based chunks (same rule as the ElevenLabs adapter) and the MP3
// frames are concatenated (decodeAudioData handles MP3 frame concat).
//
// Voice selection WORKS here (unlike VoiceTube): three different female
// northern voice names returned three distinct female voices on 2026-11-01
// (F0 228.6–236.5 Hz). CHOSEN BACKUP (user picked by ear 2026-11-01):
// "Huyền Trang" — female, northern, clear, young.
//
// IMPORTANT — credential boundary:
// The VieNeu key Muse holds in the Secure Vault (custom.vieneu) is NOT
// readable by this server and must never be copied into code/logs. A
// self-hosted server needs its OWN key in its own .env (VIENEU_API_KEY),
// entered by the operator on the deployment machine. Without it this adapter
// reports unavailable; nothing is faked. The trial key used for verification
// expires 2026-11-06; the server must not depend on it.
const BASE = 'https://api.vieneu.io';
const { splitText, stripMarkdownForSpeech } = require('./tts');

const CHUNK_MAX = 900;

function voiceId() {
  // Huyền Trang — user picked by ear ("đây đi") 2026-11-01 from 3 samples.
  return process.env.VIENEU_VOICE_ID || 'Huyền Trang';
}
function speed() {
  const s = Number(process.env.VIENEU_SPEED);
  return Number.isFinite(s) && s > 0 ? s : 1.0;
}
function emotion() {
  return process.env.VIENEU_EMOTION || 'natural';
}
function isConfigured() {
  return Boolean(process.env.VIENEU_API_KEY && voiceId());
}
function status() {
  return {
    configured: isConfigured(),
    provider: isConfigured() ? 'vieneu' : 'unavailable',
    voiceId: voiceId(),
    speed: speed(),
    emotion: emotion(),
    sync: true,
    note: isConfigured()
      ? 'VieNeu sync (một request, trả MP3). Độ trễ thực tế phải đo theo từng câu.'
      : 'Chưa có VIENEU_API_KEY trong env của server. Key trong Secure Vault của Muse không tự chảy sang server.',
  };
}

async function synthesizeChunk(input, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/v1/audio/speech`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VIENEU_API_KEY}`,
      },
      body: JSON.stringify({
        input,
        voice: voiceId(),
        engine: 'v4',
        speed: speed(),
        emotion: emotion(),
      }),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`VIENEU_HTTP_${res.status}: ${snippet}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('VIENEU_AUDIO_EMPTY');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function synthesize(text) {
  if (!isConfigured()) throw new Error('VIENEU_UNCONFIGURED');
  const started = Date.now();
  const chunks = splitText(stripMarkdownForSpeech(text), CHUNK_MAX);
  const parts = [];
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    parts.push(await synthesizeChunk(chunk));
  }
  return {
    buffer: Buffer.concat(parts),
    contentType: 'audio/mpeg',
    latencyMs: Date.now() - started,
    charCount: text.length,
    chunks: chunks.length,
  };
}

async function synthesizeToResponse(text, res) {
  const result = await synthesize(text);
  res.writeHead(200, {
    'Content-Type': result.contentType,
    'Cache-Control': 'no-store',
    'X-Vieneu-Latency-Ms': String(result.latencyMs),
    'X-Vieneu-Chunks': String(result.chunks),
  });
  res.end(result.buffer);
  return true;
}

module.exports = { isConfigured, voiceId, speed, emotion, status, synthesize, synthesizeToResponse };
