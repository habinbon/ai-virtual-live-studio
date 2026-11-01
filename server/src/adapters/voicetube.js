'use strict';
// VoiceTube TTS adapter (opt-in, async job polling) — server-side only.
//
// Verified API shape (see ~/workspace/custom-connectors/custom.voicetube/CONNECTOR.md
// and the helper voicetube.py, both checked against real calls on 2026-10-30):
//   POST /api/v1/tts/jobs  {text, voiceId, speed?}  -> job id
//   GET  /api/v1/tts/jobs/<id>                     -> status QUEUED/RUNNING/SUCCEEDED,
//                                                     outputUrl (download endpoint on
//                                                     www.voicetube.net, one 302 hop to
//                                                     a signed storage URL), outputDurationSeconds
//   GET  /api/v1/me  -> credit balance (not used here)
//
// IMPORTANT — credential boundary:
// The VoiceTube key Muse holds in the Secure Vault (custom.voicetube) is NOT
// readable by this server and must never be copied into code/logs. A self-hosted
// server needs its OWN key in its own .env (VOICETUBE_API_KEY), entered by the
// operator on the deployment machine. Without it this adapter reports
// unavailable; nothing is faked.
//
// Latency: VoiceTube is asynchronous. A first sample job took ~27s on 2026-10-30,
// so this adapter CANNOT meet the 3–5s live-answer target on its own. It is
// opt-in (TTS_PROVIDER=voicetube) for pre-recorded / queued lines, and every
// call returns its measured latencyMs so the UI can show the real wait.
// Never present a VoiceTube answer as realtime until a short-sample latency
// measurement exists for the chosen voice (see poc/LIPSYNC_POC.md).
const BASE = 'https://www.voicetube.net';
const HOST = 'www.voicetube.net';
const AUDIO_URL_KEYS = [
  'audioUrl', 'audio_url', 'downloadUrl', 'download_url',
  'fileUrl', 'file_url', 'url', 'audio', 'resultUrl',
  'outputUrl', 'output_url',
];

function isConfigured() {
  return Boolean(process.env.VOICETUBE_API_KEY && voiceId());
}
function voiceId() {
  // KHÔNG có default: voiceId cmpbxwcr4005lgi3ns8hvu79v ("Ngọc Huyền 2.0",
  // danh sách ghi nữ) đã bị LOẠI ngày 2026-11-01 vì user nghe mẫu thực tế là
  // giọng nam. Không được đặt lại làm default khi chưa có mẫu nghe thật khác.
  return process.env.VOICETUBE_VOICE_ID || '';
}
function speed() {
  const s = Number(process.env.VOICETUBE_SPEED);
  return Number.isFinite(s) && s > 0 ? s : 0.9;
}
function status() {
  return {
    configured: isConfigured(),
    provider: isConfigured() ? 'voicetube' : 'unavailable',
    voiceId: voiceId() || null,
    speed: speed(),
    async: true,
    note: isConfigured()
      ? 'VoiceTube async (job + polling). Độ trễ thực tế phải đo theo từng câu; không bảo đảm 3–5 giây.'
      : 'Chưa có VOICETUBE_API_KEY/VOICETUBE_VOICE_ID trong env của server. Key trong Secure Vault của Muse không tự chảy sang server.',
  };
}

function findAudioUrl(obj) {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (const item of obj) { const f = findAudioUrl(item); if (f) return f; }
    } else {
      for (const k of AUDIO_URL_KEYS) {
        const v = obj[k];
        if (typeof v === 'string' && v.startsWith('http')) return v;
      }
      for (const v of Object.values(obj)) { const f = findAudioUrl(v); if (f) return f; }
    }
  }
  return null;
}
function jobInfo(body) {
  if (body && typeof body === 'object') return body.job || body.modal || body;
  return {};
}
async function apiJson(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOICETUBE_API_KEY}`,
      ...(options.headers || {}),
    },
    redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep raw text in error */ }
  return { status: res.status, data, text };
}

// Fetch audio bytes following at most 5 redirects MANUALLY, so the Bearer
// credential is only ever sent to www.voicetube.net. Signed storage URLs are
// never logged or returned.
async function downloadAudio(url) {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:') throw new Error('VOICETUBE_AUDIO_NON_HTTPS');
    const headers = {};
    if (parsed.hostname === HOST) headers.Authorization = `Bearer ${process.env.VOICETUBE_API_KEY}`;
    const res = await fetch(current, { headers, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('VOICETUBE_AUDIO_REDIRECT_NO_LOCATION');
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`VOICETUBE_AUDIO_HTTP_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('VOICETUBE_AUDIO_EMPTY');
    return { buffer: buf, contentType: res.headers.get('content-type') || 'audio/wav' };
  }
  throw new Error('VOICETUBE_AUDIO_TOO_MANY_REDIRECTS');
}

// Creates a job, polls until SUCCEEDED/FAILED, downloads audio.
// Returns {buffer, contentType, jobId, latencyMs, durationSec, charCount}.
// Throws on timeout/failure — callers must surface ERROR state, not silence it.
async function synthesize(text, { pollMs = 2000, timeoutMs = 120000 } = {}) {
  if (!isConfigured()) throw new Error('VOICETUBE_UNCONFIGURED');
  const started = Date.now();
  const created = await apiJson('/api/v1/tts/jobs', {
    method: 'POST',
    body: JSON.stringify({ text, voiceId: voiceId(), speed: speed() }),
  });
  if (![200, 201, 202].includes(created.status)) {
    throw new Error(`VOICETUBE_CREATE_HTTP_${created.status}: ${String(created.text || '').slice(0, 200)}`);
  }
  const createdJob = jobInfo(created.data);
  const jobId = createdJob.jobId || createdJob.id || createdJob.job_id;
  if (!jobId) throw new Error('VOICETUBE_NO_JOB_ID');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('VOICETUBE_TIMEOUT');
    await new Promise((r) => setTimeout(r, pollMs));
    const checked = await apiJson(`/api/v1/tts/jobs/${encodeURIComponent(jobId)}`);
    if (checked.status !== 200) throw new Error(`VOICETUBE_JOB_HTTP_${checked.status}`);
    const job = jobInfo(checked.data);
    const st = String(job.status || '').toUpperCase();
    if (st === 'SUCCEEDED' || st === 'COMPLETED' || st === 'DONE') {
      const audioUrl = findAudioUrl(checked.data);
      if (!audioUrl) throw new Error('VOICETUBE_NO_AUDIO_URL');
      const audio = await downloadAudio(audioUrl);
      return {
        ...audio,
        jobId,
        latencyMs: Date.now() - started,
        durationSec: job.outputDurationSeconds ?? job.duration ?? null,
        charCount: text.length,
        creditCost: job.creditCost ?? job.modal?.creditCost ?? null,
      };
    }
    if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
      throw new Error(`VOICETUBE_JOB_${st}`);
    }
    // QUEUED / RUNNING / PROCESSING -> keep polling.
  }
}

async function synthesizeToResponse(text, res) {
  const result = await synthesize(text);
  res.writeHead(200, {
    'Content-Type': result.contentType,
    'Cache-Control': 'no-store',
    'X-VoiceTube-Job': result.jobId,
    'X-VoiceTube-Latency-Ms': String(result.latencyMs),
  });
  res.end(result.buffer);
  return true;
}

module.exports = { isConfigured, voiceId, speed, status, synthesize, synthesizeToResponse };
