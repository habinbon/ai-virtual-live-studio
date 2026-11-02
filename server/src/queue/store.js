'use strict';
// In-memory comment queue + JSON-file history store.
// History file: server/data/history.json (local only, deletable from admin).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

let seq = 1;
const queue = []; // {id,name,text,source,createdAt,status,priority,reply,mock}
let history = [];
let current = null; // item being answered

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(parsed)) history = parsed;
    }
  } catch { history = []; }
}
function saveHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(history.slice(-500), null, 2), 'utf8');
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (e) { console.error('[history] save failed:', e.message); }
}
loadHistory();

function enqueue({ name, text, source, priority = 0, direct = false, kind = 'question', visitorKey = null }) {
  const item = {
    id: `c${Date.now()}-${seq++}`,
    name, text, source: source || 'website', kind: kind === 'lesson' ? 'lesson' : 'question',
    createdAt: new Date().toISOString(),
    status: 'queued', priority, reply: null, mock: null, latencyMs: null, direct,
    visitorKey: visitorKey || null,
  };
  queue.push(item);
  return item;
}
function listQueue() {
  return [...queue].sort((a, b) => (b.priority - a.priority) || (a.createdAt < b.createdAt ? -1 : 1));
}
function pending() { return listQueue().filter((i) => i.status === 'queued'); }
function clearQueue() {
  const n = queue.filter((i) => i.status === 'queued').length;
  for (const i of queue) if (i.status === 'queued') i.status = 'cancelled';
  return n;
}
function getById(id) { return queue.find((i) => i.id === id) || null; }
function appendHistory(item) {
  history.push({
    id: item.id, name: item.name, text: item.text, source: item.source, kind: item.kind || 'question',
    reply: item.reply, mock: item.mock, latencyMs: item.latencyMs,
    createdAt: item.createdAt, answeredAt: new Date().toISOString(),
  });
  history = history.slice(-500);
  saveHistory();
}
function getHistory(limit = 50) { return [...history].reverse().slice(0, limit); }
function clearHistory() { history = []; saveHistory(); return true; }
function historyCount() { return history.length; }

module.exports = {
  enqueue, listQueue, pending, clearQueue, getById, appendHistory,
  getHistory, clearHistory, historyCount, HISTORY_FILE,
  get current() { return current; },
  set current(v) { current = v; },
};
