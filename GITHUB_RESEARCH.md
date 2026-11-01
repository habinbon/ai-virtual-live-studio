# GITHUB_RESEARCH.md — AI Virtual Live Studio

Ngày kiểm tra: 2026-11-01 (Asia/Saigon). Nguồn kiểm tra: trang GitHub của từng repo + kết quả tìm kiếm web cùng ngày.
Quy tắc: chỉ repo có giấy phép rõ ràng mới được dùng; repo không có giấy phép / giấy phép không tương thích thì LOẠI, không sao chép.
Không chạy script nào từ repo chưa kiểm tra. Mọi quyết định dưới đây đều ghi rõ commit/điểm kiểm tra đã đọc, không suy đoán từ tên repo.

> Kết luận nhanh: dùng `@pixiv/three-vrm` + React Three Fiber + drei làm lõi render.
> Lip-sync: thử `three-vrm-lip-sync` trước (PoC bắt buộc), fallback là `wawa-lipsync` / analyser tự viết — KHÔNG dùng Azure viseme cho tiếng Việt.
> ChatVRM / local-chat-vrm: chỉ tham khảo kiến trúc, không dùng làm production (đã archived).
> TikTok LIVE: KHÔNG tích hợp thư viện unofficial reverse-engineering. Adapter mặc định `UNAVAILABLE`, chỉ chạy bằng chat website + bình luận thử nghiệm.
> OBS: không viết lại livestream — dùng OBS Browser Source có sẵn.

## 1. Nhóm A — Nhân vật AI và môi trường 3D

### 1.1 pixiv/three-vrm — SỬ DỤNG (lõi render VRM)
- URL: https://github.com/pixiv/three-vrm
- Chức năng dự định: tải + hiển thị VRM (VRM 1.0/0.x), expression/blendshape, spring bone, `vrm.update(delta)` mỗi frame.
- Phiên bản/commit kiểm tra: commit `3caf7a21ee68f0d5dfa363ab3d577450bbf60136`, nhánh mặc định `dev`, 2.904 commits, 115 releases.
- Tình trạng bảo trì: đang hoạt động (không archived). 2.251 stars, 199 forks. README ví dụ dùng three 0.180.0 + `@pixiv/three-vrm@3`, có hỗ trợ WebGPURenderer từ v3.
- Giấy phép: MIT.
- Ưu điểm: thư viện chuẩn de-facto cho VRM trên Three.js; API `VRMLoaderPlugin`, expression `aa/ih/ou/ee/oh`, blink; tài liệu + ví dụ đầy đủ.
- Hạn chế: chỉ là loader/renderer — không có sẵn idle animation, ngồi, lip-sync, chat; model VRM + animation/VRMA phải tự lo license riêng; phiên bản three phải khớp (ví dụ README dùng 0.180.0).
- Kết quả thử nghiệm: chưa chạy PoC VRM thật trong turn này vì chưa có file `.vrm` có license rõ ràng để đưa vào repo. PoC trong `poc/` kiểm tra loader + fallback khi không có model. Không báo cáo "đã thử VRM thật" khi chưa có model.
- Quyết định: SỬ DỤNG. Lý do: MIT, đang bảo trì, đúng stack Next.js/React/Three.js của đặc tả.

### 1.2 pmndrs/react-three-fiber — SỬ DỤNG
- URL: https://github.com/pmndrs/react-three-fiber
- Chức năng: React renderer cho Three.js, `Canvas`, `useFrame`.
- Commit kiểm tra: `d74622ea8ed717f7212d7e19d65ff3e325508389`, 2.927 commits, 140 releases, 33.404 stars.
- Bảo trì: đang hoạt động. Lưu ý tương thích: `@react-three/fiber@8` ↔ React 18, `@react-three/fiber@9` ↔ React 19 — phải khóa cặp phiên bản, không trộn.
- Giấy phép: MIT.
- Ưu điểm / hạn chế: khai báo scene bằng JSX, hệ sinh thái pmndrs; vẫn cần hiểu Three.js gốc, và VRM loader phải gọi qua `useLoader`/imperative, không phải component có sẵn.
- Quyết định: SỬ DỤNG (cùng React 19 + fiber v9 trong scaffold, hoặc React 18 + fiber v8 nếu Next.js yêu cầu — khóa trong `package.json`, không để npm tự chọn lệch).

### 1.3 pmndrs/drei — SỬ DỤNG CÓ CHỌN LỌC
- URL: https://github.com/pmndrs/drei
- Chức năng: helper cho R3F — `Environment`, `ContactShadows`, `Float`, `useAnimations`, `Html`, `PositionalAudio`…
- Commit kiểm tra: `bf6f4addf47467d3885de272d94ca5127f6ef68f`, 2.261 commits, 10.087 stars.
- Bảo trì: đang hoạt động, không archived. Giấy phép: MIT.
- Ưu điểm: giảm code ánh sáng/môi trường/bóng; `useAnimations` hữu ích nếu có clip ngồi.
- Hạn chế: gói lớn, dùng `three-stdlib` thay `three/examples/jsm`; chỉ lấy đúng helper cần, không import cả gói vào broadcast page (ảnh hưởng FPS/ổn định).
- Quyết định: SỬ DỤNG CÓ CHỌN LỌC (Environment/ContactShadows/Float nếu cần; không bắt buộc).

### 1.4 Ứng viên khác nhóm A (đủ 3 giải pháp/module)
- **Ready Player Me / VRoid Studio (tạo model, không phải repo code):** nguồn model VRM phổ biến; license của từng model/avatar phải kiểm tra riêng trước khi dùng thương mại. Chưa chọn model nào trong turn này.
- **Open-LLM-VTuber** (xem 2.3): kiến trúc tham khảo, avatar Live2D — không đáp ứng yêu cầu "người thật ngồi trong phòng" của đặc tả nên không dùng làm renderer.
- **AIRI (moeru-ai/airi):** được nhắc trong tổng hợp cộng đồng (~43–51k stars, Live2D/VRM, realtime voice) nhưng chưa đọc trực tiếp README/license trong turn này → KHÔNG quyết định dùng; chỉ ghi nhận để đánh giá ở Giai đoạn 4 nếu cần.

## 2. Nhóm B — Nhân vật AI biết trò chuyện

### 2.1 pixiv/ChatVRM — THAM KHẢO, KHÔNG DÙNG LÀM PRODUCTION
- URL: https://github.com/pixiv/ChatVRM
- Chức năng: demo Next.js + three-vrm + ChatGPT API + Koeiromap TTS, import VRM, điều chỉnh giọng, emotion trong câu trả lời.
- Commit kiểm tra: `b542aa00e19dccf9fc48ba340cf7eee011d2329a`, 29 commits, 846 stars, 0 release.
- Bảo trì: **ARCHIVED, 2024-07-18** (README ghi rõ). Giấy phép: MIT.
- Hạn chế quyết định: code 2023, ChatGPT/Koeiromap API đã đổi, không có hàng đợi chat, moderation, state machine, TikTok, broadcast, nhạc; Koeiromap không phải giọng Việt.
- Quyết định: THAM KHẢO kiến trúc (tách: chat → emotion tag → TTS → expression) và cấu trúc thư mục demo. Không fork làm production, không copy nguyên.

### 2.2 pixiv/local-chat-vrm — THAM KHẢO, KHÔNG DÙNG
- URL: https://github.com/pixiv/local-chat-vrm
- Chức năng: demo Google I/O 2025, chạy local bằng Chrome Built-in AI + Kokoro.js, Vite + three-vrm.
- Commit: `dce56eea66140da05f997b8067c794456e9181c4`, 111 commits, 24 stars. **ARCHIVED.** Giấy phép: MIT.
- Hạn chế: chỉ chạy đúng môi trường có Chrome Built-in AI Multimodality APIs; README ghi chỉ tiếng Anh; không có server, hàng đợi, admin, OBS.
- Quyết định: THAM KHẢO phần tách engine (transcription/LLM/TTS swappable). Không dùng.

### 2.3 Open-LLM-VTuber — THAM KHẢO KIẾN TRÚC, KHÔNG DÙNG LÀM RENDERER
- URL: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber (tìm qua tìm kiếm web 2026-11-01)
- Chức năng: companion voice-interactive, Live2D, LLM swappable (Ollama/OpenAI-compatible/Gemini/Claude/DeepSeek…), ASR/TTS swappable, interrupt giữa câu, chạy offline.
- Bảo trì: đang phát triển tích cực, ~14.411 stars / 1.733 forks (ghi nhận 27/10/2026), release v1.2.1; README tự nhận "early stages, unstable, breaking changes".
- Giấy phép: MIT cho code; **model Live2D mẫu có license riêng** — phải tách riêng.
- Hạn chế với đặc tả này: avatar Live2D 2D, không phải VRM người thật ngồi phòng 3D; backend Python, không khớp stack Next.js/NestJS đề xuất; không có TikTok adapter, broadcast 9:16 cho OBS, thư viện nhạc hát nhép theo yêu cầu.
- Quyết định: THAM KHẢO kiến trúc adapter (LLM/TTS/ASR thay được, interruption, persistent chat log). Không tích hợp nguyên hệ thống.

## 3. Nhóm C — Lip Sync và chuyển động khuôn mặt

### 3.1 vlapky/three-vrm-lip-sync — THỬ NGHIỆM (PoC bắt buộc, chưa kết luận dùng)
- URL: https://github.com/vlapky/three-vrm-lip-sync
- Chức năng: `VRMLipSync.create(vrm)`, `playUrl() / useStream() / useMicrophone()`, MFCC vowel classification trong AudioWorklet (wlipsync, port của uLipSync), chỉ ghi 5 viseme VRM `aa/ih/ou/ee/oh`, tự nhả miệng khi im lặng.
- Commit kiểm tra: `23f5f9bb16208a54234410edc01c1beb78cbc2ac`, **chỉ 2 commits, 3 stars, tạo 2026-06-11, 0 release, 2 forks.** Giấy phép: MIT (cả wlipsync/uLipSync kèm theo đều MIT).
- Ưu điểm: API đúng nhu cầu nhất (audio stream → viseme, không cần phoneme data, không cần server, language-independent theo README); có example Vite+React.
- Hạn chế / rủi ro lớn: repo quá mới, quá ít commit/star, chưa có cộng đồng/issues để đối chiếu; cần secure context (localhost/HTTPS) vì AudioWorklet; profile MFCC mặc định có thể không hợp giọng Việt — README nói có thể calibrate bằng uLipSync trong Unity.
- Kết quả thử nghiệm: CHƯA chạy được PoC với audio thật + VRM thật trong turn này (thiếu model VRM + chưa cài gói). Phải chạy PoC 3 trong `poc/` trước khi khóa quyết định.
- Quyết định: THỬ NGHIỆM. Nếu PoC fail (không cài được, miệng không theo audio, trễ cao) thì chuyển sang 3.3/3.4, không bỏ tính năng lip-sync.

### 3.2 mrxz/wlipsync (lớp dưới của 3.1) — DỰ PHÒNG / LỚP THẤP
- Nguồn: npm `wlipsync@1.3.1`, MIT, MFCC-based lip-sync WASM + WebAudio, port uLipSync.
- Chức năng: `createWLipSyncNode(audioContext, profile)`; file single-file đã inline WASM + worklet.
- Hạn chế: **cần profile** — project không có công cụ tạo profile, phải tạo trong Unity bằng uLipSync rồi convert JSON→bin bằng `json2bin`; cần secure context.
- Quyết định: DỰ PHÒNG — chỉ dùng trực tiếp nếu `three-vrm-lip-sync` không đáp ứng và đã có profile calibrate cho giọng đã chọn.

### 3.3 wass08/wawa-lipsync — FALLBACK ĐƠN GIẢN
- Nguồn: npm `wawa-lipsync`, MIT, TypeScript, `Lipsync` class + Web Audio AnalyserNode, có demo R3F + Three.js 0.174 + React 19.
- Ưu điểm: dễ tích hợp nhất, không cần profile/WASM, ví dụ sẵn cho R3F.
- Hạn chế: phân tích analyser đơn giản hơn MFCC — độ chính xác viseme thấp hơn, chủ yếu theo âm lượng; chỉ nên làm fallback khi MFCC fail, không phải lựa chọn chất lượng cao.
- Quyết định: FALLBACK trong `LipSyncEngine` (interface chung, đổi engine không sửa chat/AI).

### 3.4 hecomi/uLipSync (Unity) — KHÔNG DÙNG TRỰC TIẾP, NGUỒN THUẬT TOÁN + PROFILE
- Nguồn: Unity asset, MFCC + Job/Burst, hỗ trợ VRM 0.x/1.0, profile calibrate theo nhân vật.
- Hạn chế: Unity-only, không chạy trong web; chỉ dùng để (a) hiểu thuật toán MFCC, (b) tạo profile cho wlipsync nếu cần.
- Quyết định: THAM KHẢO, không tích hợp.

### 3.5 Azure AI Speech viseme — LOẠI CHO TIẾNG VIỆT (tại thời điểm kiểm tra)
- Nguồn: tài liệu Azure "Get facial position with viseme" — viseme ID + audio offset + blend shapes qua `VisemeReceived`.
- Hạn chế quyết định: tài liệu ghi viseme **chỉ hỗ trợ `en-US` neural voices** (mục Text to speech overview, kiểm tra 2026-11-01). Không có bằng chứng viseme tiếng Việt. Dùng Azure chỉ vì viseme sẽ sai yêu cầu giọng Việt.
- Quyết định: LOẠI làm nguồn lip-sync chính cho tiếng Việt. Giữ Azure làm ứng viên TTS thay thế trong tương lai nếu Microsoft mở viseme cho vi-VN — phải kiểm tra lại tài liệu lúc đó, không giả định.

### 3.6 ElevenLabs / OpenAI TTS — KHÔNG CÓ VISEME
- ElevenLabs: có alignment/timestamp metadata theo một số tài liệu thứ cấp, nhưng không có viseme/blendshape chính thức để drive VRM. OpenAI TTS streaming cũng không cung cấp viseme/phoneme timing.
- Quyết định: TTS vẫn dùng được (xem §5), nhưng lip-sync phải đi đường audio-driven (MFCC/analyser), không chờ viseme từ nhà cung cấp.

## 4. Nhóm D — Tích hợp OBS

### 4.1 obsproject/obs-browser — KHÔNG TÍCH HỢP CODE, DÙNG TÍNH NĂNG CÓ SẴN
- Đây là mã nguồn C++ của OBS Browser Source (Chromium Embedded Framework), không phải thư viện JS để nhúng vào web app.
- Quyết định: KHÔNG clone/build. Dùng đúng cách OBS đã hỗ trợ: mở `/broadcast` trong OBS Browser Source 1080×1920, âm thanh qua OBS (Desktop Audio / Browser Source audio). Kiểm thử PoC 5 là kiểm thử OBS thật, không phải kiểm thử code repo này.

### 4.2 obsproject/obs-websocket — TÙY CHỌN GIAI ĐOẠN 3, CHƯA DÙNG Ở MVP
- Giao thức WebSocket điều khiển OBS (đổi scene, bật/tắt source) — hữu ích nếu admin muốn điều khiển OBS từ dashboard.
- Quyết định: THAM KHẢO ở Giai đoạn 3; MVP không phụ thuộc obs-websocket. Không báo cáo "điều khiển OBS" khi chưa triển khai.

### 4.3 Ứng viên thứ ba: Browser Source + Virtual Camera / RTMP (phương thức nền tảng)
- TikTok LIVE Studio / LIVE Manager / RTMP (khi tài khoản được cấp quyền) là đường phát chính thức; Virtual Camera là cầu nối từ OBS.
- Quyết định: đây là phương án vận hành, không phải repo code. Ghi rõ trong README: không giả định mọi tài khoản đều có RTMP.

## 5. TTS / LLM — adapter, không khóa nhà cung cấp

| Vai trò | Ứng viên | Trạng thái thực tế tại 2026-11-01 |
|---|---|---|
| TTS tiếng Việt realtime | ElevenLabs (Miguel `k8cFOyAg7B9qwBlDDNTC`, `eleven_v4` + `language_code: vi`) | Đã kết nối + đã verify trong các dự án trước của user (xem connector doc). Ưu tiên cho MVP vì streaming + đã có credential qua connector. Key không nằm trong repo. |
| TTS tiếng Việt (kể chuyện) | VoiceTube (HuiSheng `cmpc0y6od0004c83nq8xi7htk`, speed 0.8) | Đã kết nối + verify, nhưng job async ~27 giây cho mẫu đầu tiên (ghi nhận 30/10) → KHÔNG phù hợp mục tiêu 3–5 giây realtime. Chỉ dùng offline/dự phòng, không dùng làm TTS live mặc định. |
| TTS thay thế | Azure AI Speech / OpenAI TTS | Chưa có credential/connector trong workspace này. Chỉ thêm khi user cung cấp key qua Secure Vault, qua adapter. |
| LLM | OpenAI-compatible API (OpenAI / tương đương) | Chưa có key/connector nào được xác nhận trong turn này. Server có adapter + chế độ MOCK rõ ràng; không giả lập thành công. User phải chốt provider + key. |

## 6. TikTok Chat Adapter — QUYẾT ĐỊNH LOẠI THƯ VIỆN UNOFFICIAL

Các thư viện tìm được (isaackogan/TikTokLive Python, zerodytrash/TikTok-Live-Connector Node.js, Davincible/gotiktoklive Go, PirateTok…):
- Đều kết nối vào TikTok internal Webcast service bằng reverse-engineering, KHÔNG phải API chính thức của TikTok; nhiều thư viện phụ thuộc signing server bên thứ ba (ví dụ Eulerstream) có giới hạn/ phí, và đã từng gãy khi TikTok đổi phía server (ghi nhận: version < v4.3.8 không còn hoạt động sau thay đổi của TikTok).
- Rủi ro: vi phạm điều khoản nền tảng, mất kết nối không báo trước, lộ dữ liệu, không có bảo đảm.
- Quyết định: **LOẠI khỏi production.** Adapter trong code chỉ có 2 trạng thái thật: `UNAVAILABLE` (mặc định, chưa có quyền tích hợp hợp lệ) và `MANUAL_TEST` (bình luận thử nghiệm do admin nhập, ghi rõ nguồn). Không cài, không gọi các thư viện trên. Nếu sau này TikTok cấp quyền tích hợp chính thức, viết adapter mới theo tài liệu chính thức đó và kiểm tra lại.

## 7. Ma trận quyết định

| Module | Dùng | Tham khảo | Loại / chờ PoC |
|---|---|---|---|
| Render VRM | three-vrm, R3F, drei (chọn lọc) | — | — |
| Chat/AI skeleton | Code tự viết (adapter LLM/TTS) | ChatVRM, local-chat-vrm, Open-LLM-VTuber | — |
| Lip-sync | — (chờ PoC) | uLipSync (thuật toán/profile) | three-vrm-lip-sync: thử nghiệm; wawa-lipsync: fallback; Azure viseme: loại (en-US only) |
| OBS | Browser Source có sẵn | obs-websocket (GĐ3) | obs-browser code: không build lại |
| TikTok chat | — | — | Mọi thư viện unofficial: loại; adapter = UNAVAILABLE + test thủ công |
| Nhạc hát nhép | Audio-driven lip-sync trên file nhạc có quyền | — | AI singing (giọng tổng hợp hát): mở rộng riêng, không nhầm với lip-sync |

## 8. Việc còn lại của mục 15.4 (PoC)
- PoC 1 Avatar: cần file VRM có license → user cung cấp / chọn model. Hiện scaffold chạy fallback + loader, chưa phải PoC VRM thật.
- PoC 2 AI Voice: cần LLM key → user chốt. ElevenLabs đã có connector, chỉ test khi có text từ LLM thật.
- PoC 3 Lip Sync: chạy khi có audio TTS thật + (VRM thật hoặc fallback morph) — đo độ trễ `audioContext.currentTime` vs viseme update, ghi log.
- PoC 4 Singing: cần file nhạc có quyền do user tải lên — không dùng nhạc không rõ quyền.
- PoC 5 OBS: cần máy Windows + OBS + tài khoản TikTok có quyền LIVE của user — không thể tự kết luận từ máy này.

## 9. Đường dựng VRM từ ảnh tham khảo (nghiên cứu 2026-11-01, chỉ nghiên cứu, chưa test thật)

User gửi bảng 36 tấm và chọn "dựng nhân vật 3D gần giống cô gái trong ảnh".
Ảnh mỗi ô ~209 px, chỉ dùng làm mẫu nhìn, không tải lên dịch vụ nào. Bảng
hướng dẫn dựng: `character-ref/VROID_BUILD_SHEET.md`.

| Ứng viên | Quyết định | Lý do chính |
|---|---|---|
| VRoid Studio (pixiv, miễn phí) | **DÙNG — hướng chính** | Xuất VRM 1.0 trực tiếp, có sẵn biểu cảm A/I/U/E/O + blink; điều khoản pixiv cho phép dùng thương mại/livestream với preset không kèm điều khoản đặc biệt. Hạn chế: chỉ Windows/macOS/iPad, không chạy trên máy Linux này — cần user tự dựng theo bảng hướng dẫn hoặc thuê người dựng; kết quả là phong cách hoạt hình 3D, không giống hệt ảnh thật. Phiên bản mới nhất trên trang chính thức chưa được mở trực tiếp để kiểm chứng. |
| VRM Add-on for Blender (saturday06) | Dùng hỗ trợ | Chỉ để kiểm tra/tối ưu/chuyển đổi file VRM đã có, không tự tạo nhân vật giống ảnh. Licence của add-on chưa đọc — đọc trước khi cài/dùng. Blender chưa cài trên máy này. |
| Ready Player Me | LOẠI | Dịch vụ đã ngừng hoạt động 31/01/2026 (theo 3 nguồn độc lập trong nghiên cứu); không tạo avatar mới được nữa. |
| Meshy AI | LOẠI (hướng chính) | Bản miễn phí chỉ tải model không texture; model tạo ra không có facial blendshape; dùng ảnh tham khảo làm đầu vào thì quyền của ảnh chưa rõ. Chỉ xem lại nếu user chấp nhận trả phí + ghi nguồn và dựng bằng mô tả chữ, không tải ảnh. |
| Riggle (GLB→VRM online) | LOẠI (tạm thời) | Chưa kiểm chứng được giá, điều khoản, quyền riêng tư; không tải file lên cho tới khi kiểm tra trực tiếp. |
| Avatar SDK / MetaPerson | LOẠI | Giá Pro 800 USD/tháng, vẫn ra GLB nên vẫn cần chuyển đổi sang VRM. |
| Sample VRM miễn phí (VTubeMe, AliciaSolid, VRoid sample) | THAM KHẢO / test pipeline | Chỉ để kiểm tra loader + lip-sync, không phải nhân vật của dự án; licence phải đọc theo từng file trước khi dùng. |
| CharacterStudio (M3-org) | LOẠI | Tài liệu cũ (2023–24), không kèm asset nhân vật dùng được. |
| VTubeMe AI photo-to-VRM (7,99 USD/file) | LOẠI | Nhà cung cấp chưa kiểm chứng; tái tạo mặt thật từ ảnh trong khi quyền/chủ thể của ảnh chưa rõ; ảnh đầu vào quá nhỏ. |

Chưa kiểm chứng: chưa có file VRM nào được tạo/tải/thử; tên biểu cảm, bone
mapping, dung lượng file và tương thích với three-vrm 3.5.5 chỉ là kỳ vọng theo
tài liệu. Khi nhận được file `.vrm`, kiểm tra meta/licence trong file, ghi vào
`THIRD_PARTY_LICENSES.md`, đặt tại `apps/web/public/models/character.vrm`, rồi
chạy lại PoC 1 và PoC 3.

## §10. Mẫu VRM trên GitHub (nghiên cứu 2026-11-01, theo yêu cầu của user)
- VRM1_Constraint_Twist_Sample (vrm-c/vrm-specification, pixiv Inc., VRM 1.0, VPL 1.0): ĐÃ DÙNG làm nhân vật chính. File đã kiểm chứng (10.776.032 byte, expressions aa/ih/ou/ee/oh + blink). Ảnh chụp mẫu: phụ nữ trẻ anime, tóc dài nâu hạt dẻ, mắt nâu. Xem THIRD_PARTY_LICENSES.md.
- AvatarSample_A 0.x (arkavo-org/VRMMetalKit, pixiv VRoid Project, CC BY, commercial Allow): file đã kiểm chứng (18.566.868 byte, A/I/U/E/O + Blink, 54 bones) nhưng KHÔNG có ảnh xem trước trên repo nên ngoại hình chưa xác minh — giữ làm dự phòng, chưa lắp.
- Nova (VTubeMe): LOẠI — đàn ông trưởng thành tóc ngắn có râu. Ember (VTubeMe): LOẠI — nữ nhưng tóc ngắn, áo hoodie xanh. girl_03 (VRoid Hub): chưa tải được (cần đăng nhập pixiv), tóc vàng dạng bím.
