# Đưa Cô Quyên lên mạng — bản đầy đủ, miễn phí (Render)

Hướng dẫn này dùng ngôn ngữ đơn giản, từng bước một. Bạn là người tạo tài
khoản và nhập key — key chỉ được gõ trực tiếp trong trang cài đặt của
Render, **không gửi key qua chat, không ghi key vào code hay file nào**.

## Trước khi bắt đầu — hiểu 3 điều

1. **Gói miễn phí của Render sẽ "ngủ" khi không có ai vào** khoảng 15 phút.
   Người đầu tiên vào sau lúc ngủ sẽ đợi trang tải khoảng 30–60 giây. Đây là
   giới hạn của gói miễn phí, không phải lỗi.
2. **Lịch sử trò chuyện sẽ mất khi Render khởi động lại hoặc deploy lại.**
   File lịch sử chỉ lưu tạm trên máy chủ miễn phí. Câu hỏi và câu trả lời
   đang chạy thì không ảnh hưởng.
3. **Key của bạn sẽ bị trừ credit khi có người dùng.** Groq miễn phí có giới
   hạn lượt/ngày, ElevenLabs miễn phí có giới hạn ký tự/tháng. Máy chủ đã có
   giới hạn chống gửi quá nhanh (10 câu/phút/IP, 20 lượt đọc giọng/phút/IP),
   nhưng bạn vẫn nên thỉnh thoảng xem mức dùng trong trang quản trị của
   Groq và ElevenLabs. Nếu hết hạn mức miễn phí, trang sẽ báo lỗi TTS/LLM
   chứ không tự trừ tiền của bạn (cả hai đều là gói miễn phí, không có thẻ).

## Bước 1 — Đưa code lên GitHub

Bạn cần một tài khoản GitHub (miễn phí). Render lấy code từ GitHub để chạy.

1. Vào https://github.com/signup và tạo tài khoản (email + mật khẩu của bạn).
2. Đăng nhập xong, bấm nút **New** (tạo repository mới). Đặt tên ví dụ
   `ai-virtual-live-studio`. Để chế độ **Public** (gói miễn phí của Render
   cần repo public, hoặc private nếu bạn kết nối GitHub với Render — public
   là đơn giản nhất; code này không chứa key nên public an toàn). Bấm
   **Create repository**.
3. Trong trang repo mới, bấm chữ **uploading an existing file**.
4. Trên máy của bạn, giải nén gói zip mới nhất vào một thư mục, **giữ lại
   file `.env` cũ của bạn ở máy local, nhưng KHÔNG tải file `.env` lên
   GitHub** (file `.env` đã nằm trong danh sách loại trừ `.gitignore`, và
   bạn chỉ kéo thả các file/thư mục hiện trong thư mục dự án trừ `.env`,
   `node_modules`, `dist`). Kéo thả toàn bộ nội dung thư mục dự án vào
   trang upload của GitHub, rồi bấm **Commit changes**.
5. Kiểm tra trong repo đã có các file: `render.yaml`, `DEPLOY_RENDER.md`,
   `server/src/index.js`, `apps/web/package.json`. Nếu thiếu, tải lại.

Cách khác (nếu bạn quen dùng git): `git init`, `git add .`, `git commit`,
`git push` lên repo. Kết quả như nhau.

## Bước 2 — Tạo tài khoản Render và deploy

1. Vào https://dashboard.render.com/ và bấm **Sign Up**. Chọn **GitHub**
   để đăng nhập bằng tài khoản GitHub vừa tạo (đơn giản nhất).
2. Bấm **New +** → **Web Service** → chọn repository
   `ai-virtual-live-studio` vừa tạo → bấm **Connect**.
3. Render đọc file `render.yaml` và tự điền sẵn: tên service, lệnh build,
   lệnh chạy. Bạn kiểm tra lại:
   - **Build Command:** `cd apps/web && npm install --include=dev && npm run build` (phải có `--include=dev` vì Render đặt `NODE_ENV=production` nên `npm install` thường sẽ bỏ qua gói dev như `vite`/`typescript` và build lỗi thiếu kiểu `vite/client`)
   - **Start Command:** `node server/src/index.js`
   - **Plan:** **Free**
4. Phần **Environment Variables**: Render sẽ hỏi các giá trị còn trống.
   Bạn nhập trực tiếp tại đây, từng ô một:
   - `LLM_API_KEY` — key Groq của bạn (bắt đầu bằng `gsk_`). Lấy lại key
     mới trong https://console.groq.com/keys nếu bạn không còn giữ key cũ.
     **Nếu key cũ từng lộ trong ảnh chụp màn hình, hãy xóa key đó và tạo
     key mới trước khi nhập vào đây.**
   - `ELEVENLABS_API_KEY` — key ElevenLabs của bạn.
   - `ADMIN_PASSWORD` — **mật khẩu quản trị do bạn tự đặt**, mạnh, khác mọi
     mật khẩu khác. Bạn sẽ dùng mật khẩu này để đăng nhập trang `#/admin`.
     Nhớ mật khẩu này — quên thì phải vào lại Render để đặt lại.
   - Các biến còn lại Render đã điền sẵn theo `render.yaml`, không cần sửa.
5. Bấm **Create Web Service**. Render sẽ build khoảng 2–5 phút (lần đầu
   cài đặt gói web hơi lâu). Khi trạng thái hiện **Live**, bạn nhận được
   địa chỉ dạng `https://ai-virtual-live-studio.onrender.com`.
   Đây là địa chỉ công khai của trang web.

## Bước 3 — Kiểm tra

1. Mở địa chỉ Render vừa nhận trên trình duyệt (máy tính hoặc điện thoại).
   Trang chủ hiện lên, bấm **Vào phòng học**.
2. Gửi thử một câu hỏi ngắn. Cô Quyên trả lời bằng giọng nói và miệng cử
   động theo tiếng. (Nếu trang vừa "ngủ", lần tải đầu hơi chậm — đợi
   khoảng 1 phút rồi tải lại.)
3. Mở `https://<địa-chỉ-của-bạn>.onrender.com/#/admin`. Trang quản trị
   hiện form đăng nhập — nhập `ADMIN_PASSWORD` bạn vừa đặt. Vào được
   trong thì khóa quản trị đã hoạt động.
4. Kiểm tra địa chỉ API: `https://<địa-chỉ-của-bạn>.onrender.com/api/health`
   phải hiện `llm configured: true`, `tts configured: true`.

## Bước 4 — Cập nhật code sau này

Khi có bản sửa mới: tải gói zip mới, giải nén, kéo thả đè các file đã đổi
lên GitHub (Commit changes). Render tự deploy lại trong vài phút. Key và
mật khẩu trong phần Environment Variables của Render **không bị mất** khi
deploy lại — không cần nhập lại.

## An toàn — đọc kỹ

- **Không bao giờ** ghi key hay mật khẩu vào code, file `.env`, tin nhắn,
  hay ảnh chụp màn hình gửi đi. Key chỉ nhập trong trang Environment
  Variables của Render.
- Trang quản trị (`#/admin`) chỉ dành cho bạn. Không chia sẻ mật khẩu
  quản trị.
- Lịch sử trò chuyện trên bản công khai là nội dung học sinh gửi lên —
  đừng đăng câu chuyện riêng tư của người khác lên mạng. Bạn có thể xóa
  lịch sử bất cứ lúc nào trong trang quản trị.
- TikTok LIVE vẫn **CHƯA KHẢ DỤNG** (xem README): trang web này chạy độc
  lập, chưa nối với TikTok. Không dùng thư viện TikTok không chính thức.
- Nếu bạn không muốn công khai nữa: vào Render → service → **Suspend**
  hoặc **Delete** là trang dừng ngay.

## Sự cố thường gặp

- **Trang báo lỗi sau khi deploy:** vào Render → service → **Logs**, chụp
  màn hình phần log đỏ gửi cho mình. Thường gặp nhất là thiếu key hoặc
  sai tên biến.
- **Vào trang lần đầu rất chậm:** do gói miễn phí đang ngủ, đợi rồi tải lại.
- **Cô không nói / báo lỗi TTS:** kiểm tra `ELEVENLABS_API_KEY` trong
  Environment Variables và hạn mức miễn phí trong tài khoản ElevenLabs.
- **Cô trả lời có chữ `[BẢN DEMO]`:** `LLM_API_KEY` chưa đúng hoặc
  `LLM_BASE_URL`/`LLM_MODEL` bị sửa sai. Đối chiếu với mục 4 ở Bước 2.
- **Quên mật khẩu quản trị:** vào Render → service → **Environment** →
  sửa `ADMIN_PASSWORD` → **Save Changes** (Render deploy lại), rồi đăng
  nhập bằng mật khẩu mới.
