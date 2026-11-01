'use strict';
// TikTok Chat Adapter — intentionally UNAVAILABLE.
// No unofficial TikTok LIVE library is installed or called (see GITHUB_RESEARCH.md §6).
// Only a real, platform-permitted integration may replace this. Until then the
// studio runs fully on website comments + admin manual test comments.
function status() {
  return {
    status: 'UNAVAILABLE',
    available: false,
    connected: false,
    reason: 'Chưa có quyền tích hợp đọc bình luận TikTok LIVE được nền tảng cấp phép cho tài khoản này. Không sử dụng thư viện TikTok LIVE không chính thức.',
    sources: ['website', 'manual_test'],
    nextStep: 'Dùng bình luận website và bình luận thử nghiệm ở trang quản trị. Khi TikTok cấp quyền tích hợp chính thức, viết adapter mới theo tài liệu chính thức đó.',
  };
}
module.exports = { status };
