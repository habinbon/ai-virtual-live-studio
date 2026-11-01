# THIRD_PARTY_LICENSES.md

Chỉ liệt kê thành phần thực sự được cài/dùng trong scaffold này
(kiểm tra bằng `npm ls` ngày 2026-11-01, xem `poc/BUILD_LOG.md`).
License của model VRM, ảnh background, file nhạc KHÔNG nằm ở đây — chúng phải
có license riêng trước khi đưa vào `public/` hoặc `server/uploads/`.

| Thành phần | Phiên bản đã cài | License | Ghi chú |
|---|---|---|---|
| three | 0.180.0 | MIT | Lõi WebGL |
| @pixiv/three-vrm | 3.5.5 | MIT | Loader + expression VRM. Xem GITHUB_RESEARCH.md §1.1 |
| @react-three/fiber | 9.8.2 | MIT | React renderer cho Three.js (React 19) |
| @react-three/drei | 10.7.9 | MIT | Chỉ dùng helper chọn lọc (ContactShadows) |
| react / react-dom | 19.3.1 | MIT | |
| three-vrm-lip-sync | 0.1.0 | MIT | Adapter MFCC — chỉ dùng khi có VRM thật; trạng thái THỬ NGHIỆM, xem poc/LIPSYNC_POC.md |
| wlipsync (phụ thuộc của three-vrm-lip-sync) | 1.3.1 | MIT | Lớp WASM MFCC, dùng qua three-vrm-lip-sync |
| vite | 7.3.7 | MIT | Dev tooling / build |
| typescript | 5.9.3 | Apache-2.0 | Dev tooling |
| @vitejs/plugin-react | 5.2.0 | MIT | Dev tooling |
| @types/react, @types/react-dom, @types/three | 19.3.0 / 19.3.0 / 0.180.0 | MIT | Dev types |

Không sử dụng: mã nguồn ChatVRM/local-chat-vrm (chỉ tham khảo kiến trúc, không copy code),
thư viện TikTok LIVE unofficial (không cài, không gọi), mã nguồn OBS (obs-browser),
model/nhạc không rõ quyền. Server Node không có dependency nào (builtin http + fetch).

## VRM1_Constraint_Twist_Sample (nhân vật chính, từ 2026-11-01)
- Nguồn: https://github.com/vrm-c/vrm-specification (samples/VRM1_Constraint_Twist_Sample)
- Tác giả: pixiv Inc., (c) 2022. Định dạng: VRM 1.0, 10.776.032 byte, MD5 b36a6fbb65316d5684de896dedee4f26.
- Giấy phép (meta trong file, VRM Public License 1.0, https://vrm.dev/licenses/1.0/): avatarPermission everyone, commercialUsage corporation, allowRedistribution true, modification allowModificationRedistribution, creditNotation unnecessary.
- Biểu cảm trong file: aa/ih/ou/ee/oh, blink/blinkLeft/blinkRight, happy, angry, sad, relaxed, surprised, look directions. Dùng làm nhân vật livestream trong studio; không phân phối lại file thô dưới dạng asset riêng.
