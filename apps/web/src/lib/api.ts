export type QueueItem = {
  id: string; name: string; text: string; source: string;
  createdAt: string; status: 'queued' | 'thinking' | 'answered' | 'error' | 'cancelled';
  priority: number; reply: string | null; mock: boolean | null; latencyMs: number | null;
  kind?: 'question' | 'lesson';
};
export type Health = {
  ok: boolean; state: string;
  flags: { aiRunning: boolean; autoReply: boolean; paused: boolean };
  llm: { configured: boolean; mock: boolean; model: string | null };
  tts: { configured: boolean; provider: string; voiceId: string; model: string; languageCode: string; note: string };
  tiktok: { status: string; available: boolean; reason: string };
  queueLength: number; historyCount: number; lastError: { at: string; message: string } | null;
};
export type MusicTrack = { file: string; name: string; size: number; url: string; uploadedAt: string };

async function j<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
}
export const api = {
  health: () => fetch('/api/health').then((r) => j<Health>(r)),
  tiktok: () => fetch('/api/tiktok/status').then((r) => j<Health['tiktok'] & { sources: string[]; nextStep: string }>(r)),
  queue: () => fetch('/api/queue').then((r) => j<{ flags: Health['flags']; current: QueueItem | null; items: QueueItem[] }>(r)),
  history: (limit = 50) => fetch(`/api/history?limit=${limit}`).then((r) => j<{ items: Array<QueueItem & { answeredAt: string }> ; count: number }>(r)),
  chat: (name: string, text: string, source = 'website') =>
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text, source }) })
      .then(async (r) => ({ status: r.status, body: await j<Record<string, unknown>>(r) })),
  say: (text: string) =>
    fetch('/api/admin/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      .then((r) => j<Record<string, unknown>>(r)),
  lesson: (topic: string) =>
    fetch('/api/admin/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic }) })
      .then((r) => j<Record<string, unknown>>(r)),
  answer: (id: string) =>
    fetch('/api/admin/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      .then((r) => j<Record<string, unknown>>(r)),
  control: (action: string) =>
    fetch('/api/admin/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => j<{ ok: boolean; flags: Health['flags'] }>(r)),
  clearQueue: () => fetch('/api/admin/clear-queue', { method: 'POST' }).then((r) => j<{ ok: boolean; cleared: number }>(r)),
  clearHistory: () => fetch('/api/history', { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
  music: () => fetch('/api/music').then((r) => j<{ items: MusicTrack[] }>(r)),
  uploadMusic: (file: File) =>
    fetch('/api/music/upload', { method: 'POST', headers: { 'X-Filename': file.name, 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      .then(async (r) => ({ status: r.status, body: await j<Record<string, unknown>>(r) })),
  adminSession: () => fetch('/api/admin/session').then((r) => j<{ adminEnabled: boolean; authenticated: boolean; production: boolean }>(r)),
  adminLogin: (password: string) =>
    fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      .then(async (r) => ({ status: r.status, body: await j<Record<string, unknown>>(r) })),
  adminLogout: () => fetch('/api/admin/logout', { method: 'POST' }).then((r) => j<{ ok: boolean }>(r)),
};
