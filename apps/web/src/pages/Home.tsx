export function HomePage() {
  return (
    <main className="home">
      <header className="topbar">
        <strong>AI Virtual Live Studio</strong>
        <nav><a href="#/live">Phòng live</a><a href="#/admin">Quản trị</a><a href="#/broadcast">Broadcast (OBS)</a></nav>
      </header>
      <section className="hero">
        <p className="ai-badge">NHÂN VẬT LÀ AI — không phải người thật</p>
        <h1>Cô giáo AI dạy học trực tuyến, giảng bài và trả lời câu hỏi bằng giọng nói.</h1>
        <p>
          Cô Quyên — giáo viên AI — ngồi trong lớp học ảo, giảng bài từng bước và trả lời
          câu hỏi của học sinh thành tiếng, đồng bộ khẩu hình với âm thanh. Giáo viên
          dạy bài mới từ trang quản trị; học sinh gửi câu hỏi ở phòng học.
        </p>
        <div className="cta-row">
          <a className="btn primary" href="#/live">Vào phòng học</a>
          <a className="btn" href="#/admin">Bảng điều khiển</a>
        </div>
        <p className="muted">
          MVP chạy bằng bình luận trên website + bình luận thử nghiệm từ trang quản trị.
          TikTok LIVE: <strong>chưa khả dụng</strong> — chưa có quyền tích hợp hợp lệ (xem /api/tiktok/status).
          Không có API key nào ở phía trình duyệt.
        </p>
      </section>
      <section className="status-table">
        <h2>Trạng thái tính năng</h2>
        <table>
          <thead><tr><th>Tính năng</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
          <tbody>
            <tr><td>Phòng live + chat website</td><td>ĐÃ CÓ</td><td>WebSocket/SSE + polling; kiểm duyệt, chống spam, hàng đợi.</td></tr>
            <tr><td>Avatar + chuyển động idle</td><td>ĐÃ CÓ (tạm)</td><td>Avatar procedural khi chưa có file VRM có license.</td></tr>
            <tr><td>Lip-sync audio-driven</td><td>ĐÃ CÓ</td><td>Analyser fallback; MFCC (three-vrm-lip-sync) chỉ khi có VRM thật.</td></tr>
            <tr><td>Trả lời bằng LLM thật</td><td>CẦN KEY</td><td>Chưa có LLM_API_KEY → chế độ MOCK_DEMO ghi rõ trong câu trả lời.</td></tr>
            <tr><td>Giọng ElevenLabs</td><td>CẦN KEY</td><td>Chưa có ELEVENLABS_API_KEY → demo bằng SpeechSynthesis của trình duyệt.</td></tr>
            <tr><td>Hát nhép theo nhạc thật</td><td>ĐÃ CÓ (thư viện trống)</td><td>Chỉ phát file do quản trị tải lên, có quyền sử dụng.</td></tr>
            <tr><td>Broadcast cho OBS 1080×1920</td><td>ĐÃ CÓ</td><td>Trang /broadcast sạch, không menu admin.</td></tr>
            <tr><td>Đọc bình luận TikTok LIVE</td><td>CHƯA KHẢ DỤNG</td><td>Không dùng thư viện unofficial. Cần quyền tích hợp chính thức.</td></tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
