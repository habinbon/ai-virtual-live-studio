'use strict';
// AI Virtual Live Studio — server (Node builtin http only, no framework, no deps).
// API keys live ONLY in process env, never in code or responses.
// A tiny .env parser is included so `cp .env.example .env` works without deps.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env');
try {
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch (e) { console.error('[env] load failed:', e.message); }

const moderation = require('./moderation/moderation');
const store = require('./queue/store');
const llm = require('./adapters/llm');
const tts = require('./adapters/tts');
const voicetube = require('./adapters/voicetube');
const tiktok = require('./adapters/tiktok');
const auth = require('./auth');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const UPLOADS_DIR = path.join(ROOT, 'server', 'uploads');
const DIST_DIR = path.join(ROOT, 'apps', 'web', 'dist');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---- IP + rate limit (chống lạm dụng API công khai) ----
// Sau proxy (Render) IP thật nằm ở X-Forwarded-For; chỉ tin header này khi
// TRUST_PROXY=1 (máy chủ đặt trong render.yaml). Giới hạn theo IP + route,
// cửa sổ trượt 60 giây, lưu trong bộ nhớ (reset khi khởi động lại).
const rateBuckets = new Map();
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}
function rateLimit(req, res, key, maxPerMinute) {
  const now = Date.now();
  const bucketKey = `${key}:${clientIp(req)}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || now - bucket.start > 60_000) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.count += 1;
  if (bucket.count > maxPerMinute) {
    sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Bạn gửi quá nhanh, đợi một lát rồi thử lại.' });
    return false;
  }
  return true;
}

// ---- chặn route quản trị khi chưa đăng nhập ----
function requireAdmin(req, res) {
  if (auth.isAuthenticated(req)) return true;
  if (!auth.adminEnabled() && auth.isProduction()) {
    sendJson(res, 503, { error: 'ADMIN_PASSWORD_REQUIRED', message: 'Chưa đặt mật khẩu quản trị (ADMIN_PASSWORD) trên máy chủ.' });
  } else {
    sendJson(res, 401, { error: 'ADMIN_AUTH_REQUIRED', message: 'Đăng nhập quản trị trước.' });
  }
  return false;
}

// ---- runtime flags (admin-controlled, in-memory) ----
const flags = { aiRunning: true, autoReply: true, paused: false };
let processing = false;
let lastError = null;

// ---- SSE clients ----
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(body);
}
function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}
function readRawBody(req, limit = 50_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- queue processor: one answer at a time (single main audio source) ----
async function processQueue() {
  if (processing) return;
  if (!flags.aiRunning || !flags.autoReply || flags.paused) return;
  const next = store.pending()[0];
  if (!next) return;
  processing = true;
  const started = Date.now();
  next.status = 'thinking';
  store.current = next;
  broadcast('queue', { queue: store.listQueue(), current: next });
  try {
    // Manual "say" items are spoken verbatim — never rewritten by the LLM/mock.
    // Lesson items are taught by the LLM with the lesson prompt.
    const result = next.direct
      ? { text: next.text, mock: false, provider: 'manual' }
      : next.kind === 'lesson'
        ? await llm.generateLesson({ topic: next.text, history: store.getHistory(6) })
        : await llm.generateReply({
            name: next.name, text: next.text, history: store.getHistory(6),
          });
    next.reply = result.text;
    next.mock = result.mock;
    next.latencyMs = Date.now() - started;
    next.status = 'answered';
    store.appendHistory(next);
    broadcast('answered', { item: next, queue: store.listQueue() });
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: String(e.message || e).slice(0, 300) };
    next.status = 'error';
    next.reply = null;
    console.error('[processor] LLM error:', e.message);
    broadcast('error', { error: lastError, item: next });
  } finally {
    store.current = null;
    processing = false;
    // Continue with the next queued item on the next tick.
    setTimeout(processQueue, 300);
  }
}
setInterval(processQueue, 800);

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
function safeFilename(name) {
  return String(name || 'track').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'track';
}
function listMusic() {
  return fs.readdirSync(UPLOADS_DIR)
    .filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => {
      const st = fs.statSync(path.join(UPLOADS_DIR, f));
      return { file: f, name: f, size: st.size, url: `/api/music/${encodeURIComponent(f)}`, uploadedAt: st.mtime.toISOString() };
    });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      });
      return res.end();
    }

    // SSE
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true, service: 'ai-virtual-live-studio',
        build: 'jobinfo-fix-20261101',
        state: flags.aiRunning ? (flags.paused ? 'PAUSED' : 'IDLE') : 'STOPPED',
        flags,
        llm: { configured: llm.isConfigured(), mock: !llm.isConfigured(), model: process.env.LLM_MODEL || null },
        teacher: { subject: llm.teacherSubject(), level: llm.teacherLevel() },
        tts: tts.status(),
        ttsProvider: process.env.TTS_PROVIDER === 'voicetube' ? 'voicetube'
          : (tts.isConfigured() ? 'elevenlabs' : (voicetube.isConfigured() ? 'voicetube' : 'unavailable')),
        voicetube: voicetube.status(),
        tiktok: tiktok.status(),
        queueLength: store.pending().length,
        historyCount: store.historyCount(),
        lastError,
        uptimeSec: Math.round(process.uptime()),
      });
    }

    if (req.method === 'GET' && pathname === '/api/tiktok/status') {
      return sendJson(res, 200, tiktok.status());
    }

    if (req.method === 'GET' && pathname === '/api/tts/status') {
      // Combined status: ElevenLabs (streaming) is the live default; VoiceTube
      // (async) is opt-in via TTS_PROVIDER=voicetube. Neither is faked.
      const provider = process.env.TTS_PROVIDER === 'voicetube' ? 'voicetube'
        : (tts.isConfigured() ? 'elevenlabs' : (voicetube.isConfigured() ? 'voicetube' : 'unavailable'));
      return sendJson(res, 200, { provider, elevenlabs: tts.status(), voicetube: voicetube.status() });
    }

    if (req.method === 'GET' && pathname === '/api/voicetube/status') {
      return sendJson(res, 200, voicetube.status());
    }

    // ---- quản trị: đăng nhập / phiên / đăng xuất ----
    if (req.method === 'GET' && pathname === '/api/admin/session') {
      return sendJson(res, 200, {
        adminEnabled: auth.adminEnabled(),
        authenticated: auth.isAuthenticated(req),
        production: auth.isProduction(),
      });
    }
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      if (!rateLimit(req, res, 'admin-login', 5)) return;
      if (!auth.adminEnabled()) {
        // Máy local chưa đặt mật khẩu: mở như trước (kèm cảnh báo ở giao diện).
        if (!auth.isProduction()) return sendJson(res, 200, { ok: true, adminEnabled: false, authenticated: true });
        return sendJson(res, 503, { error: 'ADMIN_PASSWORD_REQUIRED', message: 'Chưa đặt mật khẩu quản trị (ADMIN_PASSWORD) trên máy chủ.' });
      }
      const body = await readJsonBody(req);
      if (!auth.checkPassword(body.password)) {
        return sendJson(res, 401, { error: 'WRONG_PASSWORD', message: 'Sai mật khẩu quản trị.' });
      }
      const token = auth.issueToken();
      res.setHeader('Set-Cookie', auth.cookieHeader(token));
      return sendJson(res, 200, { ok: true, adminEnabled: true, authenticated: true });
    }
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      res.setHeader('Set-Cookie', auth.cookieHeader('', true));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/tts') {
      if (!rateLimit(req, res, 'tts', 20)) return;
      const body = await readJsonBody(req);
      const text = String(body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'EMPTY_TEXT' });
      if (text.length > 8000) return sendJson(res, 400, { error: 'TOO_LONG' });
      // Long texts are split into <=900-char chunks inside the TTS adapter
      // and streamed back as one MP3 response (see adapters/tts.js).
      // Provider selection: explicit TTS_PROVIDER wins; otherwise ElevenLabs
      // (streaming) if configured, else VoiceTube (async) if configured.
      const wantVoicetube = process.env.TTS_PROVIDER === 'voicetube';
      const useVoicetube = wantVoicetube ? voicetube.isConfigured()
        : (!tts.isConfigured() && voicetube.isConfigured());
      if (useVoicetube) {
        try {
          await voicetube.synthesizeToResponse(text, res);
          return;
        } catch (e) {
          lastError = { at: new Date().toISOString(), message: `VoiceTube TTS: ${String(e.message || e).slice(0, 200)}` };
          if (!res.headersSent) return sendJson(res, 502, { error: 'TTS_ERROR', message: lastError.message, provider: 'voicetube' });
          return;
        }
      }
      if (!tts.isConfigured()) {
        return sendJson(res, 503, { error: 'TTS_UNAVAILABLE', message: 'Chưa có ELEVENLABS_API_KEY hay VOICETUBE_API_KEY trong env của server. Frontend dùng SpeechSynthesis demo.' });
      }
      try {
        const handled = await tts.synthesizeToResponse(text, res);
        if (!handled) return sendJson(res, 503, { error: 'TTS_UNAVAILABLE' });
        return;
      } catch (e) {
        lastError = { at: new Date().toISOString(), message: `TTS: ${String(e.message || e).slice(0, 200)}` };
        if (!res.headersSent) return sendJson(res, 502, { error: 'TTS_ERROR', message: lastError.message });
        return;
      }
    }

    // Bình luận công khai của học sinh: giới hạn theo IP, qua kiểm duyệt.
    if (req.method === 'POST' && pathname === '/api/chat') {
      if (!rateLimit(req, res, 'chat', 10)) return;
      const body = await readJsonBody(req);
      const check = moderation.check({ name: body.name, text: body.text });
      if (!check.ok) {
        return sendJson(res, 422, { ok: false, status: 'rejected', reason: check.reason, message: check.message });
      }
      const item = store.enqueue({ name: check.name, text: check.text, source: 'website' });
      broadcast('queue', { queue: store.listQueue() });
      setTimeout(processQueue, 50);
      return sendJson(res, 202, {
        ok: true, status: 'queued', id: item.id, position: store.pending().length,
        message: 'Đã nhận bình luận, đang chờ AI trả lời.',
      });
    }

    // Bình luận thử nghiệm của quản trị viên: cần đăng nhập quản trị.
    if (req.method === 'POST' && pathname === '/api/admin/test-comment') {
      if (!requireAdmin(req, res)) return;
      const body = await readJsonBody(req);
      const check = moderation.check({ name: body.name, text: body.text });
      if (!check.ok) {
        return sendJson(res, 422, { ok: false, status: 'rejected', reason: check.reason, message: check.message });
      }
      const item = store.enqueue({ name: check.name, text: check.text, source: 'manual_test' });
      broadcast('queue', { queue: store.listQueue() });
      setTimeout(processQueue, 50);
      return sendJson(res, 202, {
        ok: true, status: 'queued', id: item.id, position: store.pending().length,
        message: 'Đã nhận bình luận, đang chờ AI trả lời.',
      });
    }

    if (req.method === 'GET' && pathname === '/api/queue') {
      return sendJson(res, 200, { flags, current: store.current, items: store.listQueue() });
    }

    if (req.method === 'POST' && pathname === '/api/admin/say') {
      if (!requireAdmin(req, res)) return;
      const body = await readJsonBody(req);
      const text = String(body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'EMPTY_TEXT' });
      const item = store.enqueue({ name: 'Quản trị viên', text: text.slice(0, 500), source: 'manual_test', priority: 10, direct: true });
      broadcast('queue', { queue: store.listQueue() });
      setTimeout(processQueue, 50);
      return sendJson(res, 202, { ok: true, status: 'queued', id: item.id });
    }

    if (req.method === 'POST' && pathname === '/api/admin/lesson') {
      if (!requireAdmin(req, res)) return;
      const body = await readJsonBody(req);
      const topic = String(body.topic || '').trim();
      if (!topic) return sendJson(res, 400, { error: 'EMPTY_TOPIC' });
      const item = store.enqueue({ name: 'Cô Quyên', text: topic.slice(0, 200), source: 'manual_test', priority: 10, kind: 'lesson' });
      broadcast('queue', { queue: store.listQueue() });
      setTimeout(processQueue, 50);
      return sendJson(res, 202, { ok: true, status: 'queued', id: item.id });
    }

    if (req.method === 'POST' && pathname === '/api/admin/answer') {
      if (!requireAdmin(req, res)) return;
      const body = await readJsonBody(req);
      const item = store.getById(body.id);
      if (!item) return sendJson(res, 404, { error: 'NOT_FOUND' });
      if (item.status !== 'queued') return sendJson(res, 409, { error: 'NOT_QUEUED', status: item.status });
      item.priority = 10;
      broadcast('queue', { queue: store.listQueue() });
      setTimeout(processQueue, 50);
      return sendJson(res, 200, { ok: true, id: item.id });
    }

    if (req.method === 'POST' && pathname === '/api/admin/control') {
      if (!requireAdmin(req, res)) return;
      const body = await readJsonBody(req);
      const action = body.action;
      if (action === 'start') { flags.aiRunning = true; flags.paused = false; }
      else if (action === 'stop') { flags.aiRunning = false; }
      else if (action === 'pause') { flags.paused = true; }
      else if (action === 'resume') { flags.paused = false; flags.aiRunning = true; }
      else if (action === 'autoReplyOn') { flags.autoReply = true; }
      else if (action === 'autoReplyOff') { flags.autoReply = false; }
      else return sendJson(res, 400, { error: 'UNKNOWN_ACTION' });
      broadcast('flags', { flags });
      setTimeout(processQueue, 50);
      return sendJson(res, 200, { ok: true, flags });
    }

    if (req.method === 'POST' && pathname === '/api/admin/clear-queue') {
      if (!requireAdmin(req, res)) return;
      const n = store.clearQueue();
      broadcast('queue', { queue: store.listQueue() });
      return sendJson(res, 200, { ok: true, cleared: n });
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      return sendJson(res, 200, { items: store.getHistory(limit), count: store.historyCount() });
    }
    if (req.method === 'DELETE' && pathname === '/api/history') {
      if (!requireAdmin(req, res)) return;
      store.clearHistory();
      return sendJson(res, 200, { ok: true, count: 0 });
    }

    if (req.method === 'GET' && pathname === '/api/music') {
      return sendJson(res, 200, { items: listMusic() });
    }
    if (req.method === 'POST' && pathname === '/api/music/upload') {
      if (!requireAdmin(req, res)) return;
      const filename = safeFilename(req.headers['x-filename'] || 'track.mp3');
      const ext = path.extname(filename).toLowerCase();
      const ct = String(req.headers['content-type'] || '');
      if (!AUDIO_EXTS.has(ext) || !(ct.startsWith('audio/') || ct === 'application/octet-stream')) {
        await readRawBody(req).catch(() => Buffer.alloc(0));
        return sendJson(res, 415, { error: 'NOT_AUDIO', message: 'Chỉ chấp nhận file âm thanh (mp3/wav/ogg/m4a/flac).' });
      }
      const buf = await readRawBody(req);
      if (!buf.length) return sendJson(res, 400, { error: 'EMPTY_FILE' });
      const dest = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(dest, buf);
      return sendJson(res, 201, { ok: true, file: filename, size: buf.length, url: `/api/music/${encodeURIComponent(filename)}` });
    }
    if (req.method === 'GET' && pathname.startsWith('/api/music/')) {
      const file = safeFilename(decodeURIComponent(pathname.slice('/api/music/'.length)));
      const full = path.join(UPLOADS_DIR, file);
      if (!fs.existsSync(full) || !AUDIO_EXTS.has(path.extname(file).toLowerCase())) {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      const ext = path.extname(file).toLowerCase();
      const mime = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' }[ext] || 'audio/mpeg';
      res.writeHead(200, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
      return fs.createReadStream(full).pipe(res);
    }

    // Phục vụ giao diện đã build (production): apps/web/dist do Render build.
    // Khi chạy dev bằng Vite (chưa có dist) thì giữ hành vi cũ: API-only.
    if (req.method === 'GET' && !pathname.startsWith('/api')) {
      if (fs.existsSync(DIST_DIR)) {
        const STATIC_TYPES = {
          '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
          '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary',
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
          '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
        };
        let filePath = pathname === '/' ? path.join(DIST_DIR, 'index.html')
          : path.join(DIST_DIR, decodeURIComponent(pathname));
        // Chặn thoát khỏi thư mục dist.
        if (!filePath.startsWith(DIST_DIR)) return sendJson(res, 403, { error: 'FORBIDDEN' });
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
        return fs.createReadStream(filePath).pipe(res);
      }
      if (pathname === '/') {
        return sendJson(res, 200, { ok: true, service: 'ai-virtual-live-studio', docs: 'Xem README.md. Web chạy ở cổng Vite (5173), API ở cổng này.' });
      }
    }
    return sendJson(res, 404, { error: 'NOT_FOUND', path: pathname });
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL', message: String(e.message || e).slice(0, 200) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] listening http://${HOST}:${PORT}`);
  console.log(`[server] LLM configured=${llm.isConfigured()} TTS configured=${tts.isConfigured()} TikTok=UNAVAILABLE adminEnabled=${auth.adminEnabled()}`);
});
