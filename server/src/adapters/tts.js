'use strict';
// TTS adapter: ElevenLabs streaming, server-side only.
// No key -> unavailable; frontend falls back to browser SpeechSynthesis (demo, labelled).
// VoiceTube is NOT used for live TTS (async ~27s, see GITHUB_RESEARCH.md §5).
const DEFAULT_VOICE_ID = '7iUjM4919D20JYbu4ISi'; // Linh Sensei, female/northern/vi, ear-approved by user 2026-11-01

function isConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}
function voiceId() {
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
}
function status() {
  return {
    configured: isConfigured(),
    provider: isConfigured() ? 'elevenlabs' : 'unavailable',
    voiceId: voiceId(),
    model: 'eleven_v4',
    languageCode: 'vi',
    maxChars: 8000,
    chunkMax: CHUNK_MAX,
    note: isConfigured()
      ? 'ElevenLabs streaming phía server (đoạn dài tự cắt nhỏ).'
      : 'Chưa có ELEVENLABS_API_KEY — frontend dùng SpeechSynthesis của trình duyệt làm demo, ghi rõ trong UI.',
  };
}

// Long replies (teacher mode: detailed answers, lessons) routinely exceed
// ElevenLabs' comfortable single-request size, and the old /api/tts route
// rejected anything over 1000 chars with HTTP 400 — which silenced speech
// entirely. So long texts are split into sentence-based chunks (<=900 chars)
// and streamed back-to-back as one MP3 response: first audio still arrives
// fast, and decodeAudioData handles the concatenated frames.
const CHUNK_MAX = 900;

function splitText(text, maxLen = CHUNK_MAX) {
  const src = String(text || '').trim();
  if (!src) return [];
  const pieces = src.split(/(?<=[.!?…\n])\s+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = (s) => { if (s) chunks.push(s); };
  for (const piece of pieces) {
    const nextLen = (cur ? cur.length + 1 : 0) + piece.length;
    if (nextLen <= maxLen) {
      cur = cur ? `${cur} ${piece}` : piece;
      continue;
    }
    push(cur);
    cur = '';
    if (piece.length <= maxLen) {
      cur = piece;
    } else {
      // One very long sentence: hard-split it so no chunk exceeds the cap.
      for (let i = 0; i < piece.length; i += maxLen) push(piece.slice(i, i + maxLen));
    }
  }
  push(cur);
  return chunks.length ? chunks : [src];
}

async function fetchChunkAudio(chunkText, signal) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId())}/stream?output_format=mp3_44100_128`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: chunkText,
      model_id: 'eleven_v4',
      language_code: 'vi',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
    }),
    signal,
  });
}

// Câu trả lời của LLM thường chứa ký tự markdown (**đậm**, # tiêu đề, `code`)
// vì model quen viết cho màn hình — nhưng câu trả lời ở đây được ĐỌC THÀNH
// TIẾNG, nên các ký tự đó phải được lược bỏ trước khi tổng hợp giọng nói.
function stripMarkdownForSpeech(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\n)#{1,6}\s+/g, '$1')
    .replace(/([.!?…])\s*#{1,6}\s+/g, '$1 ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Streams ElevenLabs audio into an http.ServerResponse. Returns false if unavailable.
async function synthesizeToResponse(text, res) {
  if (!isConfigured()) return false;
  const chunks = splitText(stripMarkdownForSpeech(text));
  if (!chunks.length) return false;
  let wroteHead = false;
  try {
    for (const chunkText of chunks) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let upstream;
      try {
        upstream = await fetchChunkAudio(chunkText, controller.signal);
      } catch (e) {
        clearTimeout(timer);
        console.error('[tts] chunk fetch failed:', e.message);
        if (!wroteHead) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'TTS_UPSTREAM_ERROR', message: String(e.message || e).slice(0, 200) }));
        } else res.end();
        return true;
      }
      clearTimeout(timer);
      if (!upstream.ok || !upstream.body) {
        const body = await upstream.text().catch(() => '');
        if (!wroteHead) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'TTS_UPSTREAM_ERROR', status: upstream.status, detail: body.slice(0, 200) }));
        } else {
          console.error('[tts] later chunk failed:', upstream.status, body.slice(0, 200));
          res.end();
        }
        return true;
      }
      if (!wroteHead) {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
        wroteHead = true;
      }
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise((r) => res.once('drain', r));
      }
    }
    res.end();
    return true;
  } catch (e) {
    console.error('[tts] stream failed:', e.message);
    try { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'TTS_UPSTREAM_ERROR' })); } else res.end(); } catch { /* client gone */ }
    return true;
  }
}

module.exports = { isConfigured, voiceId, status, synthesizeToResponse, splitText, stripMarkdownForSpeech, DEFAULT_VOICE_ID };
