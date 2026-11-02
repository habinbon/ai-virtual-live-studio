'use strict';
// Moderation: spam / banned content / duplicate / per-user rate limit.
// Pure functions + small in-memory state. No external service.
const BANNED = [
  'địt', 'đụ', 'lồn', 'cặc', 'buồi', 'fuck', 'shit', 'bitch',
  'casino', 'cá độ', 'sex', 'porn', 'xxx',
  'http://', 'https://', 'www.', '.com', '.vn', 't.me/', 'bit.ly',
  'mua ngay', 'kiếm tiền nhanh', 'đầu tư chắc thắng',
];
const MAX_LEN = 500;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;
const DUPLICATE_MS = 60_000;

// name -> timestamps[]
const rateMap = new Map();
// `${name}|${text}` -> timestamp
const seenMap = new Map();

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function check({ name, text }, opts = {}) {
  const cleanName = String(name || 'Khách').trim().slice(0, 40) || 'Khách';
  const cleanText = String(text || '').trim();
  if (!cleanText) return { ok: false, reason: 'EMPTY', message: 'Bình luận trống.' };
  if (cleanText.length > MAX_LEN) return { ok: false, reason: 'TOO_LONG', message: 'Bình luận quá dài (tối đa 500 ký tự).' };
  const lower = normalize(cleanText);
  for (const word of BANNED) {
    if (lower.includes(word)) {
      return { ok: false, reason: 'BLOCKED_CONTENT', message: 'Bình luận chứa nội dung không phù hợp hoặc link/quảng cáo.' };
    }
  }
  // Spam: same char repeated, or ALL CAPS long, or many repeated words
  if (/(.)\1{9,}/.test(cleanText)) {
    return { ok: false, reason: 'SPAM', message: 'Bình luận giống spam.' };
  }
  const now = Date.now();
  const key = `${normalize(cleanName)}|${lower}`;
  // Câu trả lời trong bảng khảo sát được miễn kiểm tra trùng lặp và giới
  // hạn tốc độ: đáp án ngắn như "có", "thỉnh thoảng" lặp lại là bình thường
  // và 10 câu trả lời liên tiếp sẽ vượt 3 tin/phút. Nội dung cấm vẫn chặn.
  if (!opts.inSurvey) {
    const last = seenMap.get(key);
    if (last && now - last < DUPLICATE_MS) {
      return { ok: false, reason: 'DUPLICATE', message: 'Bình luận trùng lặp vừa gửi.' };
    }
    const arr = (rateMap.get(normalize(cleanName)) || []).filter((t) => now - t < WINDOW_MS);
    if (arr.length >= MAX_PER_WINDOW) {
      return { ok: false, reason: 'RATE_LIMIT', message: 'Bạn gửi quá nhanh, chờ một chút nhé.' };
    }
    arr.push(now);
    rateMap.set(normalize(cleanName), arr);
  }
  seenMap.set(key, now);
  // prune
  for (const [k, t] of seenMap) if (now - t > DUPLICATE_MS) seenMap.delete(k);
  return { ok: true, name: cleanName, text: cleanText };
}

function resetForTests() { rateMap.clear(); seenMap.clear(); }

module.exports = { check, resetForTests, MAX_LEN };
