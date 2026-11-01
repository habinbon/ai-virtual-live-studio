'use strict';
// Admin authentication for public deployment.
//
// - Mật khẩu quản trị nằm trong env ADMIN_PASSWORD (chỉ người vận hành biết,
//   nhập trong phần cài đặt của máy chủ, KHÔNG gửi qua chat, KHÔNG vào code).
// - Đăng nhập đúng -> cookie HttpOnly chứa token HMAC-SHA256, hết hạn 12 giờ.
// - Chưa đặt ADMIN_PASSWORD: ở máy local (NODE_ENV khác production) trang
//   quản trị vẫn mở như trước, kèm cảnh báo; ở production thì mọi route
//   quản trị đều bị chặn cho đến khi đặt mật khẩu.
// - Không có tài khoản người dùng, không lưu mật khẩu dưới dạng văn bản
//   trong bất kỳ file nào của dự án.
const crypto = require('crypto');

function adminEnabled() {
  return Boolean(String(process.env.ADMIN_PASSWORD || '').trim());
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function secret() {
  if (process.env.ADMIN_SECRET) return String(process.env.ADMIN_SECRET);
  // Suy ra từ mật khẩu: đổi mật khẩu -> mọi phiên cũ mất hiệu lực.
  return crypto.createHash('sha256').update(`admin-secret:${process.env.ADMIN_PASSWORD || ''}`).digest('hex');
}

function issueToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = `v1.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expect = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(parts[2] || '', 'utf8');
  const b = Buffer.from(expect, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthenticated(req) {
  // Máy local không đặt mật khẩu: coi như đã xác thực (chỉ chạy localhost),
  // giao diện sẽ hiện cảnh báo rõ ràng.
  if (!adminEnabled()) return !isProduction();
  return verifyToken(parseCookies(req).admin_session);
}

function checkPassword(input) {
  if (!adminEnabled()) return false;
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(process.env.ADMIN_PASSWORD)).digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieHeader(token, clear = false) {
  const attrs = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : 'Max-Age=43200',
  ];
  if (isProduction()) attrs.push('Secure');
  return `admin_session=${token}; ${attrs.join('; ')}`;
}

module.exports = {
  adminEnabled, isProduction, isAuthenticated, checkPassword,
  issueToken, verifyToken, cookieHeader,
};
