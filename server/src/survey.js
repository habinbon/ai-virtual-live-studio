'use strict';
// Bảng khảo sát tâm lý 10 câu — do người vận hành cung cấp nguyên văn
// (2026-11-02). Cô Quyên hỏi TỪNG CÂU MỘT: câu trả lời của khách cho câu
// trước sẽ mở ra câu tiếp theo; đủ 10 câu thì LLM nhận định ban đầu
// (chỉ tham khảo, KHÔNG chẩn đoán, KHÔNG dán nhãn) rồi mời kết nối với
// chuyên gia thật. Trạng thái khảo sát theo từng khách (visitor id từ
// trình duyệt, dự phòng theo tên), lưu best-effort vào server/data/.
// Render Free xóa dữ liệu tạm khi ngủ/khởi động lại — khách chỉ cần làm
// lại bảng từ đầu, không mất gì khác.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SURVEY_FILE = path.join(DATA_DIR, 'surveys.json');

// Nguyên văn 10 câu do người vận hành gửi 2026-11-02. Không sửa câu chữ.
const QUESTIONS = [
  'Tôi cảm thấy khó có thể giữ bình tĩnh hay thư giãn.',
  'Tôi thấy mình dễ bực bội, cáu gắt hoặc phản ứng thái quá với những việc nhỏ.',
  'Tôi cảm thấy buồn chán, u uất hoặc không tìm thấy niềm vui trong các hoạt động hàng ngày.',
  'Tôi hay lo lắng quá mức về những chuyện sắp xảy ra hoặc các rủi ro nhỏ.',
  'Tôi cảm thấy khó tập trung khi làm việc, đọc sách hoặc suy nghĩ.',
  'Tôi luôn có cảm giác kiệt sức, thiếu năng lượng dù ngủ đủ giấc.',
  'Tôi thấy mình tự ti, đánh giá thấp bản thân hoặc cảm thấy vô dụng.',
  'Tôi khó đi vào giấc ngủ hoặc hay thức dậy giữa đêm vì suy nghĩ miên man.',
  'Tôi có cảm giác bồn chồn, đứng ngồi không yên hoặc hồi hộp vô cớ.',
  'Tôi có xu hướng muốn thu mình lại, ngại giao tiếp hoặc tránh né gặp gỡ mọi người.',
];

// Số điện thoại chuyên gia do người vận hành cung cấp 2026-11-02 để hiển
// thị trong lời mời kết nối. Đổi bằng env EXPERT_PHONE khi cần.
function expertPhone() {
  return String(process.env.EXPERT_PHONE || '').trim() || '0919231296';
}
function expertZoomUrl() {
  return String(process.env.EXPERT_ZOOM_URL || '').trim();
}

// Lời mời kết nối cố định, gắn sau phần nhận định của LLM để số điện thoại
// và link Zoom luôn hiện nguyên văn, không qua model viết lại.
function handoffParagraph() {
  const phone = expertPhone();
  const zoom = expertZoomUrl();
  if (zoom) {
    return `Nếu bạn muốn nói chuyện trực tiếp với bác sĩ, chuyên gia tâm lý Quyên, bạn có thể gọi số ${phone}, hoặc kết nối trực tuyến qua Zoom tại đây: ${zoom}. Bạn chọn cách nào cũng được, cô Quyên sẽ chờ bạn nhé.`;
  }
  return `Nếu bạn muốn nói chuyện trực tiếp với bác sĩ, chuyên gia tâm lý Quyên, bạn có thể gọi số ${phone}. Bạn cũng có thể kết nối trực tuyến qua Zoom, bạn nhắn lại một tiếng để cô Quyên gửi link cho bạn nhé.`;
}

// Từ khóa dừng khảo sát — chỉ khớp khi toàn bộ tin nhắn đúng các từ này,
// để câu trả lời bình thường như "tôi muốn dừng suy nghĩ" không bị dừng nhầm.
const CANCEL_TEXTS = new Set([
  'dừng', 'hủy', 'dừng lại', 'dừng khảo sát', 'hủy khảo sát',
  'không khảo sát', 'không làm nữa', 'bỏ qua', 'thoát',
]);
function isCancel(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return CANCEL_TEXTS.has(t);
}
function normalizeName(name) {
  return String(name || 'Khách').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40) || 'khách';
}
function keyFor(visitor, name) {
  const v = String(visitor || '').trim().slice(0, 64);
  if (v) return `v:${v}`;
  return `n:${normalizeName(name)}`;
}

// ---- state ----
let states = {}; // key -> { name, concern, answers: string[], done: bool, updatedAt }
function loadStates() {
  try {
    if (fs.existsSync(SURVEY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SURVEY_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') states = parsed;
    }
  } catch { states = {}; }
}
function saveStates() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SURVEY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(states, null, 2), 'utf8');
    fs.renameSync(tmp, SURVEY_FILE);
  } catch (e) { console.error('[survey] save failed:', e.message); }
}
loadStates();

function getState(key) { return states[key] || null; }
function hasActive(key) {
  const s = states[key];
  return Boolean(s && !s.done && s.answers.length < QUESTIONS.length);
}
function isDone(key) {
  const s = states[key];
  return Boolean(s && s.done);
}

// Câu hỏi đầu tiên kèm lời chào + giải thích ngắn. Phần còn lại của câu
// trả lời này được đọc thành tiếng nên viết ngắn, không markdown.
function startSurvey(key, name, concern) {
  states[key] = {
    name: String(name || 'Khách').trim().slice(0, 40) || 'Khách',
    concern: String(concern || '').slice(0, 500),
    answers: [],
    done: false,
    updatedAt: new Date().toISOString(),
  };
  saveStates();
  return {
    text: `Chào ${states[key].name} nhé, cô Quyên nghe bạn rồi. Để hiểu rõ hơn cảm xúc của bạn, cô có bảng khảo sát ngắn 10 câu. Bạn cứ trả lời ngắn gọn theo cảm nhận của mình nhé. Câu 1 trên 10: ${QUESTIONS[0]}`,
    mock: false, provider: 'survey',
  };
}

function cancelSurvey(key) {
  delete states[key];
  saveStates();
  return {
    text: 'Được rồi, mình dừng bảng khảo sát ở đây nhé. Bạn cứ kể tiếp hoặc hỏi cô Quyên điều khác nhé.',
    mock: false, provider: 'survey',
  };
}

// Ghi câu trả lời cho câu hiện tại. Trả về câu tiếp theo, hoặc
// { needsAssessment: true } khi vừa đủ 10 câu để processor gọi LLM.
function recordAnswer(key, text) {
  const s = states[key];
  if (!s) return null;
  s.answers.push(String(text || '').slice(0, 500));
  s.updatedAt = new Date().toISOString();
  if (s.answers.length >= QUESTIONS.length) {
    s.done = true;
    saveStates();
    return { needsAssessment: true, state: s };
  }
  saveStates();
  const n = s.answers.length + 1;
  return {
    needsAssessment: false,
    text: `Cảm ơn bạn. Câu ${n} trên 10: ${QUESTIONS[n - 1]}`,
    mock: false, provider: 'survey',
  };
}

module.exports = {
  QUESTIONS, keyFor, getState, hasActive, isDone, isCancel,
  startSurvey, cancelSurvey, recordAnswer, handoffParagraph,
  expertPhone, expertZoomUrl,
};
