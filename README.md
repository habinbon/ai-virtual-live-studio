# AI Virtual Live Studio — MVP

Nhân vật AI livestream (tên mặc định **Quyên**) ngồi trong studio ảo, trả lời bình luận
bằng giọng nói, đồng bộ khẩu hình với âm thanh. **Nhân vật là AI — không phải người thật**,
điều này được ghi rõ trên mọi trang.

Scaffold MVP chạy thật trên máy này (Node v24.22.1, npm 10.9.4), theo
`GITHUB_RESEARCH.md` (đọc trước khi sửa code). Không copy code từ ChatVRM/local-chat-vrm.
Không dùng thư viện TikTok LIVE không chính thức.

## Chạy thử

```bash
# 1. Biến môi trường (xem .env.example — chỉ tên biến, không có key thật)
cp .env.example .env   # ở thư mục gốc dự án; để trống = chế độ demo ghi rõ

# 2. Server API (Node builtin http, không cần npm install — không có dependency)
cd server && PORT=3001 node src/index.js
# -> http://127.0.0.1:3001/api/health

# 3. Web (terminal khác)
cd apps/web && npm install && npm run dev
# -> http://127.0.0.1:5173/  (hash routing: #/live, #/broadcast, #/admin)
# Build production: npm run build && npm run preview  (http://127.0.0.1:4173/)
```

Server đọc file `.env` ở gốc dự án (parser tự viết, không cần dotenv).
Web dev/preview proxy mọi `/api/*` sang `http://127.0.0.1:3001`.

## Cấu hình (.env)

| Biến | Bắt buộc? | Tác dụng |
|---|---|---|
| `PORT` | Không (mặc định 3001) | Cổng server API |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Không — nếu thiếu thì **MOCK_DEMO** | LLM OpenAI-compatible. Không có key: câu trả lời bắt đầu bằng `[BẢN DEMO — chưa có LLM]`, không giả vờ là AI thật |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Không — nếu thiếu thì TTS unavailable | ElevenLabs streaming phía server (`eleven_v4`, `language_code: vi`, giọng đã chốt Linh Sensei `7iUjM4919D20JYbu4ISi`, user duyệt bằng tai 2026-11-01). Không có key: trình duyệt dùng SpeechSynthesis làm demo, UI ghi rõ |
| `TTS_PROVIDER`, `VOICETUBE_API_KEY`, `VOICETUBE_VOICE_ID`, `VOICETUBE_SPEED` | Không — opt-in | VoiceTube async (job + polling, `server/src/adapters/voicetube.js`). Giọng Ngọc Huyền 2.0 đã **bị loại** sau khi user nghe mẫu thật là giọng nam và kiểm chứng kỹ cho thấy API không chọn được giọng (xem `poc/VOICETUBE_SAMPLE.md`); **giọng Live Studio đã chốt là Linh Sensei trên ElevenLabs**, VoiceTube không còn là hướng giọng chính. Độ trễ mẫu ~23 giây, không đạt 3–5 giây. **Key trong Secure Vault của Muse không tự chảy sang server** — người vận hành phải nhập key vào `.env` của server. `TTS_PROVIDER=voicetube` ép dùng VoiceTube; để trống thì ưu tiên ElevenLabs |
| `CHARACTER_SYSTEM_PROMPT` | Không | System prompt nhân vật (mặc định trong `server/src/adapters/llm.js`) |

**Không bao giờ** ghi key vào code, `.env.example`, log hay báo cáo. API key chỉ ở
server env. Frontend không chứa key nào. VoiceTube là adapter opt-in async
(~23 giây/job mẫu đo được, xem `poc/VOICETUBE_SAMPLE.md`), không phải TTS live
mặc định; key của Muse trong Secure Vault không tự chảy sang server.

## Các trang (hash routing trong 1 Vite app)

| Route | Nội dung |
|---|---|
| `#/` | Giới thiệu + bảng trạng thái tính năng + ghi rõ "Nhân vật là AI" |
| `#/live` | Phòng xem: avatar 70% / chat 30% desktop; mobile dọc 9:16, chat phủ dưới, ô chat cố định cuối |
| `#/broadcast` | Trang sạch cho OBS: chỉ avatar + background + phụ đề. Không menu admin. Thêm `?audio=off` để tắt tiếng, `?bg=music` để đổi background |
| `#/admin` | Dashboard: Start/Stop, tự trả lời, câu nói thủ công, chọn bình luận, xóa hàng đợi, đổi background/giọng/nhân vật, kiểm tra âm thanh, upload nhạc, lịch sử |

## Luồng hoạt động

```
Bình luận (website / thử nghiệm) → POST /api/chat → kiểm duyệt (từ cấm/spam/
trùng lặp/rate-limit) → hàng đợi → LLM (hoặc MOCK_DEMO) → câu trả lời
→ TTS ElevenLabs (hoặc SpeechSynthesis demo) → Lip-sync audio-driven
→ avatar nói (state machine: THINKING → SPEAKING → IDLE)
```

- State machine riêng: `apps/web/src/state/machine.ts`
  (IDLE, LISTENING, THINKING, SPEAKING, SINGING, TRANSITION, PAUSED, ERROR).
  Chỉ 1 nguồn âm thanh chính tại 1 thời điểm; nhạc dừng/giảm khi trả lời;
  lỗi TTS → ERROR → phục hồi IDLE + thông báo.
- Lip-sync: interface chung `apps/web/src/lipsync/engine.ts`. Engine mặc định là
  **AnalyserNode fallback tự viết** (volume → mouthOpen, miệng đóng hẳn sau
  250ms im lặng). Adapter MFCC `three-vrm-lip-sync` chỉ khởi tạo khi có model
  VRM thật (`apps/web/src/lipsync/vrmAdapter.ts`, dynamic import + try/catch —
  build không gãy nếu fail). Không dùng Azure viseme (chỉ en-US).
- Avatar: `@pixiv/three-vrm` + React Three Fiber + drei. Loader thử tải
  `apps/web/public/models/character.vrm`; khi chưa có file thì dùng **avatar tạm
  procedural** và hiển thị rõ trạng thái đó. Không tải model/nhạc/ảnh không rõ
  license. Idle (nháy mắt, thở, xoay đầu, mỉm cười) viết bằng `useFrame`.
- Hàng đợi + lịch sử: `server/src/queue/store.js`; lịch sử lưu file JSON local
  `server/data/history.json`, xóa được từ admin.
- TikTok: `GET /api/tiktok/status` luôn trả `UNAVAILABLE` + lý do. Không cài,
  không gọi thư viện TikTok unofficial nào.

## Kiểm tra âm thanh

1. Chạy server + web như trên. Mở `#/admin` → **Kiểm tra âm thanh**.
   Chưa có key: trình duyệt đọc bằng SpeechSynthesis, miệng avatar mô phỏng
   theo nhịp (ghi rõ là demo). Có key: âm thanh ElevenLabs thật qua `/api/tts`,
   miệng theo analyser.
2. Gửi bình luận ở `#/live`, xem trạng thái xử lý (đang chờ → đang suy nghĩ →
   trả lời bằng văn bản + giọng nói), miệng đóng hẳn sau khi nói xong.
3. Hát nhép: ở `#/admin` tải file nhạc có quyền lên (chỉ audio), bấm
   Phát/hát nhép — miệng theo file thật. Gửi bình luận → nhạc dừng rồi mới nói.
4. Đo độ trễ (trình duyệt): `AudioManager.lastLatency` ghi `ttsFetchMs` và
   `playToFirstVisemeMs` sau mỗi lần nói bằng ElevenLabs. Mục tiêu thiết kế
   3–5 giây bắt đầu nói — phải đo thực tế, không coi là bảo đảm. Xem
   `poc/LIPSYNC_POC.md` (chưa đo được MFCC vì chưa có model VRM thật).

## OBS Browser Source (1080×1920)

1. OBS → Sources → **+ Browser** → URL: `http://127.0.0.1:5173/#/broadcast`
   (hoặc URL production đã deploy), Width **1080**, Height **1920**.
   Bật "Control audio via OBS" để âm thanh đi cùng hình ảnh.
2. Kiểm tra: hình avatar + phụ đề hiện trong preview; bấm Kiểm tra âm thanh ở
   admin (tab khác) → tiếng ra cùng Browser Source, không chồng nhạc.
3. Đưa lên TikTok: dùng **TikTok LIVE Studio / LIVE Manager / RTMP chỉ khi
   tài khoản được cấp quyền**, qua OBS Virtual Camera hoặc phương thức phát
   được TikTok hỗ trợ cho tài khoản đó. Không giả định mọi tài khoản đều có RTMP.
4. Bình luận TikTok: **chưa khả dụng** cho tới khi có quyền tích hợp chính thức.
   Trong lúc đó, đọc bình luận website ở `#/live` và bình luận thử nghiệm ở `#/admin`.

## Bảng trạng thái tính năng

| Tính năng | Trạng thái |
|---|---|
| Phòng live + chat website + kiểm duyệt + hàng đợi | ĐÃ CÓ |
| Avatar procedural + idle + VRM loader (chờ file có license) | ĐÃ CÓ (tạm) |
| State machine + 1 nguồn âm thanh + hủy câu trả lời | ĐÃ CÓ |
| Lip-sync analyser fallback | ĐÃ CÓ |
| Lip-sync MFCC cho VRM thật | CHƯA ĐO ĐƯỢC (cần model VRM + audio thật; xem poc/) |
| LLM thật | CẦN KEY (`LLM_API_KEY` + `LLM_BASE_URL`) |
| TTS ElevenLabs thật | CẦN KEY (`ELEVENLABS_API_KEY`) |
| TTS VoiceTube (chưa có giọng chốt) | ADAPTER ĐÃ CÓ, CẦN KEY RIÊNG CHO SERVER (`VOICETUBE_API_KEY`); Ngọc Huyền 2.0 đã loại (nghe thật là nam); độ trễ mẫu ~23 giây, không realtime |
| Hát nhép theo file nhạc thật | ĐÃ CÓ (thư viện trống — chỉ file có quyền) |
| Broadcast OBS 1080×1920 | ĐÃ CÓ |
| Đọc bình luận TikTok LIVE | CHƯA KHẢ DỤNG (cần quyền tích hợp chính thức) |
| Đăng nhập admin / phân quyền | ĐÃ CÓ (mật khẩu ADMIN_PASSWORD, cookie HttpOnly + token HMAC 12 giờ; production không có mật khẩu thì chặn toàn bộ route quản trị) |
| Nhiều nhân vật / trang phục / ngôn ngữ / trò chơi | DỰ KIẾN (Giai đoạn 4) |

## Đối chiếu nghiệm thu 1–15 (đặc tả §13)

1. Desktop + mobile: layout 70/30 + 9:16 — có; chưa kiểm thử trên thiết bị thật.
2. Chuyển động khi không nói: idle useFrame — có (nháy mắt/thở/xoay đầu/mỉm cười).
3. Trạng thái xử lý chat: có (queued → thinking → answered, thông báo sau khi gửi).
4. Trả lời văn bản + giọng nói: có (demo = SpeechSynthesis khi chưa có key).
5. Miệng đồng bộ âm thanh: analyser fallback — có; VRM thật chưa kiểm chứng.
6. Hát nhép với nhạc thật đã tải: có (cần file có quyền do quản trị tải lên).
7. Không nói chồng nhạc: nhạc dừng trước khi nói (AudioManager + state machine).
8. Điều khiển thủ công từ dashboard: có.
9. Broadcast chạy liên tục, không công cụ admin: có (trang riêng, không menu).
10. OBS nhận hình + tiếng: **chưa kiểm thử** — cần máy Windows + OBS + tài khoản
    TikTok có quyền LIVE của user (PoC 5, xem GITHUB_RESEARCH.md §8).
11. TikTok adapter báo đúng trạng thái: có (`UNAVAILABLE` + lý do).
12. Không key ở client, không giả lập kết nối thật: có (key server-only; mock ghi rõ).
13. Kiểm duyệt/spam/dữ liệu/dừng khẩn cấp: kiểm duyệt + xóa lịch sử + Stop/Pause có;
    nút dừng khẩn cấp riêng chưa tách (Stop AI + Hủy câu trả lời đang dùng tạm).
14. Giới thiệu rõ là AI: có trên mọi trang + trong system prompt.
15. Tính năng chưa hỗ trợ hiển thị rõ: có (bảng trạng thái + badge TikTok/LLM/TTS).

## Bảo mật & dữ liệu

- API key chỉ ở server env; `.env` trong `.gitignore`; `.env.example` chỉ có tên biến trống.
- Lịch sử chat lưu local `server/data/history.json` (không commit); xóa từ admin.
- File nhạc tải lên lưu `server/uploads/` (không commit); chỉ chấp nhận audio,
  chỉ thêm file có quyền sử dụng.
- Đăng nhập quản trị: mật khẩu `ADMIN_PASSWORD` trong env (xem
  `server/src/auth.js`); đăng nhập đúng cấp cookie HttpOnly chứa token HMAC
  hết hạn 12 giờ. Ở production, chưa đặt mật khẩu thì mọi route quản trị
  đều bị chặn. Ở máy local không đặt mật khẩu thì trang quản trị vẫn mở
  (kèm cảnh báo) vì chỉ chạy localhost.
- Chống lạm dụng API công khai: `POST /api/chat` tối đa 10/phút/IP,
  `POST /api/tts` tối đa 20/phút/IP, đăng nhập admin tối đa 5/phút/IP
  (IP thật lấy từ `X-Forwarded-For` khi `TRUST_PROXY=1` — đặt trong
  `render.yaml`). Giới hạn lưu trong bộ nhớ, reset khi khởi động lại.
- Deploy công khai (Render, gói miễn phí): xem `DEPLOY_RENDER.md` và
  `render.yaml`. Lịch sử trên máy chủ miễn phí là tạm thời, mất khi
  khởi động lại/deploy lại.
- Không cài/không chạy script từ repo chưa kiểm tra; không dùng thư viện TikTok unofficial.

## Cấu trúc

```
apps/web/            Vite + React 19 + R3F + three-vrm (hash routing)
  src/state/machine.ts        State machine
  src/lipsync/                LipSyncEngine + adapter three-vrm-lip-sync
  src/components/AvatarCanvas.tsx   VRM loader + fallback procedural + room 3D
  src/components/useLiveSession.ts  Poll queue + auto-speak + lip-sync pump
  src/audio/playback.ts       AudioManager (1 nguồn âm thanh chính)
  src/pages/                  Home / Live / Broadcast / Admin
server/              Node builtin http, không dependency
  src/index.js                Routes API + SSE + music upload + processor
  src/adapters/               llm.js (OpenAI-compatible / mock) · tts.js (ElevenLabs)
                              tiktok.js (UNAVAILABLE)
  src/moderation/             Từ cấm / spam / trùng lặp / rate-limit
  src/queue/store.js          Hàng đợi + lịch sử JSON
music/                README — thư viện trống, chỉ file có quyền
poc/                  BUILD_LOG.md · LIPSYNC_POC.md
GITHUB_RESEARCH.md    Nghiên cứu repo bắt buộc (đọc trước)
THIRD_PARTY_LICENSES.md Giấy phép thành phần thực sự dùng
```
