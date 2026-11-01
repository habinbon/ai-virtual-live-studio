import { useEffect, useState } from 'react';
import { AvatarCanvas, BACKGROUNDS, type BackgroundPreset } from '../components/AvatarCanvas';
import { useLiveSession } from '../components/useLiveSession';
import { api, type MusicTrack } from '../lib/api';

export function AdminPage() {
  const [background, setBackground] = useState<BackgroundPreset>('podcast');
  const [sayText, setSayText] = useState('');
  const [lessonTopic, setLessonTopic] = useState('');
  const [testName, setTestName] = useState('Khách thử');
  const [testText, setTestText] = useState('Quyên ơi, hôm nay có vui không?');
  const [adminMsg, setAdminMsg] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; name: string; text: string; reply: string | null; mock: boolean | null; latencyMs: number | null; createdAt: string }>>([]);
  const [voice, setVoice] = useState('elevenlabs-default');
  const [character, setCharacter] = useState('fallback');
  const [vrmStatus, setVrmStatus] = useState('checking');
  const [adminAuth, setAdminAuth] = useState<{ adminEnabled: boolean; authenticated: boolean; production: boolean } | null>(null);
  const [pw, setPw] = useState('');
  const [loginMsg, setLoginMsg] = useState('');
  const session = useLiveSession({ autoSpeak: true, audioEnabled: true });
  const { health, queue } = session;

  const loadAll = async () => {
    try { setTracks((await api.music()).items); } catch { /* ignore */ }
    try { setHistory((await api.history(30)).items); } catch { /* ignore */ }
    await session.refresh();
  };
  useEffect(() => {
    void (async () => {
      try { setAdminAuth(await api.adminSession()); } catch { setAdminAuth({ adminEnabled: false, authenticated: false, production: false }); }
      await loadAll();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doLogin() {
    setLoginMsg('');
    const r = await api.adminLogin(pw);
    if (r.status === 200) {
      setPw('');
      try { setAdminAuth(await api.adminSession()); } catch { /* ignore */ }
      await loadAll();
    } else if (r.status === 503) {
      setLoginMsg('Máy chủ chưa đặt mật khẩu quản trị (ADMIN_PASSWORD).');
    } else if (r.status === 429) {
      setLoginMsg('Bạn thử đăng nhập quá nhanh, đợi một lát rồi thử lại.');
    } else {
      setLoginMsg('Sai mật khẩu quản trị.');
    }
  }

  async function control(action: string) {
    await api.control(action);
    setAdminMsg(`Đã thực hiện: ${action}`);
    await loadAll();
  }
  async function uploadMusic(file: File) {
    const r = await api.uploadMusic(file);
    setAdminMsg(r.status === 201 ? `Đã tải lên: ${String(r.body.file)}` : String(r.body.message || r.body.error || 'Tải lên thất bại'));
    await loadAll();
  }

  return (
    <div className="admin">
      <header className="topbar">
        <a href="#/">← Trang chủ</a><strong>AI Live Control Center</strong>
        <span className="muted">Admin UI — không chứa API key. Key chỉ ở server env.</span>
        {adminAuth?.authenticated
          ? <button className="btn small" onClick={async () => { await api.adminLogout(); try { setAdminAuth(await api.adminSession()); } catch { /* ignore */ } }}>Đăng xuất</button>
          : <span className="muted">Chưa đăng nhập quản trị.</span>}
      </header>

      {adminAuth && adminAuth.authenticated && !adminAuth.adminEnabled && (
        <div className="error-box" role="alert">Máy chủ chưa đặt mật khẩu quản trị (ADMIN_PASSWORD) — trang quản trị đang mở tự do. Chỉ chạy trên máy của bạn, đừng đưa lên mạng khi chưa đặt mật khẩu.</div>
      )}
      {adminAuth === null && <p className="muted">Đang kiểm tra đăng nhập quản trị…</p>}
      {adminAuth && !adminAuth.authenticated && (
        <section className="card">
          <h2>Đăng nhập quản trị</h2>
          <p className="muted small">Mật khẩu do bạn đặt trong biến môi trường ADMIN_PASSWORD của máy chủ. Nhập ở đây, mật khẩu không được lưu trong trình duyệt.</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mật khẩu quản trị" onKeyDown={(e) => { if (e.key === 'Enter') void doLogin(); }} />
          <button className="btn primary" onClick={() => void doLogin()}>Đăng nhập</button>
          {loginMsg && <p className="muted" role="status">{loginMsg}</p>}
        </section>
      )}

      {adminAuth?.authenticated && (
      <div className="admin-grid">
        <section className="card preview-card">
          <h2>Preview nhân vật</h2>
          <div className="preview-box">
            <AvatarCanvas anim={session.anim} background={background} onVrmStatus={(s) => setVrmStatus(s)} lipSyncNote={session.lipSyncNote} onLipSyncNote={session.setLipSyncNote} />
          </div>
          <p className="muted small">Trạng thái AI: {session.machineState} · VRM: {vrmStatus} · Đang nói: {session.speakingText || '—'}</p>
          {session.errorMsg && <div className="error-box" role="alert">{session.errorMsg}</div>}
        </section>

        <section className="card">
          <h2>Trạng thái hệ thống</h2>
          <ul className="kv">
            <li>AI: <b>{health?.flags.aiRunning ? 'ĐANG CHẠY' : 'ĐÃ DỪNG'}</b> · Tự trả lời: <b>{health?.flags.autoReply ? 'BẬT' : 'TẮT'}</b> · Tạm dừng: <b>{health?.flags.paused ? 'CÓ' : 'KHÔNG'}</b></li>
            <li>LLM: <b>{health?.llm.configured ? 'Đã cấu hình' : 'MOCK_DEMO — chưa có key'}</b></li>
            <li>TTS: <b>{health?.tts.provider}</b> — {health?.tts.note || ''}</li>
            <li>TikTok: <b>{health?.tiktok.status} — CHƯA KHẢ DỤNG</b><br /><span className="muted small">{health?.tiktok.reason}</span></li>
            <li>Hàng đợi: <b>{health?.queueLength ?? 0}</b> · Lịch sử: <b>{health?.historyCount ?? 0}</b></li>
            {health?.lastError && <li>Lỗi gần nhất: {health.lastError.message}</li>}
          </ul>
          <div className="row wrap">
            <button className="btn" onClick={() => void control('start')}>Start AI</button>
            <button className="btn" onClick={() => void control('stop')}>Stop AI</button>
            <button className="btn" onClick={() => void control('pause')}>Tạm dừng AI</button>
            <button className="btn" onClick={() => void control('resume')}>Tiếp tục</button>
            <button className="btn" onClick={() => void control(health?.flags.autoReply ? 'autoReplyOff' : 'autoReplyOn')}>{health?.flags.autoReply ? 'Tắt tự trả lời' : 'Bật tự trả lời'}</button>
            <button className="btn" onClick={async () => { await api.clearQueue(); setAdminMsg('Đã xóa hàng đợi.'); await loadAll(); }}>Xóa hàng đợi</button>
            <button className="btn" onClick={() => void session.speak('Xin chào, Quyên là nhân vật AI. Đây là kiểm tra âm thanh.').catch(() => setAdminMsg('Kiểm tra âm thanh thất bại — xem lỗi TTS.'))}>Kiểm tra âm thanh</button>
          </div>
          {adminMsg && <p className="muted" role="status">{adminMsg}</p>}
        </section>

        <section className="card">
          <h2>Hàng đợi bình luận</h2>
          {queue.length === 0 && <p className="muted">Hàng đợi trống.</p>}
          {queue.map((i) => (
            <div key={i.id} className="comment">
              <b>{i.name}</b> <span className="muted">({i.source} · {i.status}{i.kind === 'lesson' ? ' · BÀI GIẢNG' : ''})</span><br />{i.kind === 'lesson' ? `Bài giảng: ${i.text}` : i.text}
              {i.reply && <><br /><span className="reply">Cô Quyên: {i.reply}</span></>}
              <div className="row">
                {i.status === 'queued' && <button className="btn small" onClick={async () => { await api.answer(i.id); await loadAll(); }}>Chọn để trả lời</button>}
              </div>
            </div>
          ))}
          <h3>Bình luận thử nghiệm (nguồn manual_test)</h3>
          <input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="Tên người gửi thử" />
          <input value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="Nội dung thử nghiệm" />
          <button className="btn" onClick={async () => {
            const r = await fetch('/api/admin/test-comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: testName, text: testText }) });
            setAdminMsg(r.ok ? 'Đã thêm bình luận thử nghiệm.' : 'Bình luận thử nghiệm bị từ chối (kiểm duyệt).');
            await loadAll();
          }}>Thêm bình luận thử</button>
        </section>

        <section className="card">
          <h2>Nói thủ công</h2>
          <input value={sayText} onChange={(e) => setSayText(e.target.value)} placeholder="Câu nói để nhân vật đọc…" maxLength={500} />
          <button className="btn primary" onClick={async () => { if (!sayText.trim()) return; await api.say(sayText.trim()); setSayText(''); setAdminMsg('Đã đưa câu nói thủ công vào hàng đợi ưu tiên.'); await loadAll(); }}>Nhân vật đọc ngay</button>
          <p className="muted small">Câu nói thủ công được đọc nguyên văn (không qua LLM), ở hàng đợi ưu tiên.</p>

          <h2>Cấu hình nhanh</h2>
          <label>Background
            <select value={background} onChange={(e) => setBackground(e.target.value as BackgroundPreset)}>
              {Object.entries(BACKGROUNDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label>Giọng đọc (hiển thị — giọng ElevenLabs thật do server env quyết định)
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="elevenlabs-default">ElevenLabs Linh Sensei — eleven_v4, vi (server)</option>
              <option value="browser-vi">Giọng trình duyệt tiếng Việt (demo, khi chưa có key)</option>
            </select>
          </label>
          <label>Nhân vật
            <select value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option value="fallback">Avatar tạm procedural</option>
              <option value="vrm" disabled={vrmStatus !== 'vrm'}>Model VRM {vrmStatus !== 'vrm' ? '(chưa có file character.vrm)' : '(đã tải)'}</option>
            </select>
          </label>
          <p className="muted small">Đổi nhân vật/giọng thật cần file VRM có license và key TTS ở server — xem README. Tính cách (system prompt) cấu hình bằng biến môi trường CHARACTER_SYSTEM_PROMPT ở server.</p>
        </section>

        <section className="card">
          <h2>Dạy bài mới</h2>
          <input value={lessonTopic} onChange={(e) => setLessonTopic(e.target.value)} placeholder="Chủ đề bài giảng, ví dụ: Phân số lớp 4…" maxLength={200} />
          <button className="btn primary" onClick={async () => { if (!lessonTopic.trim()) return; await api.lesson(lessonTopic.trim()); setLessonTopic(''); setAdminMsg('Đã đưa bài giảng vào hàng đợi ưu tiên.'); await loadAll(); }}>Cô Quyên dạy bài này</button>
          <p className="muted small">Cô Quyên soạn bài giảng có mục tiêu, giảng từng bước, ví dụ và câu luyện tập, rồi đọc lên như trên lớp. Môn học và trình độ lấy từ TEACHER_SUBJECT / TEACHER_LEVEL trong file .env của server.</p>
        </section>

        <section className="card">
          <h2>Thư viện nhạc — chỉ file có quyền</h2>
          <p className="muted small">Tải lên file âm thanh bạn sở hữu hoặc được cấp phép livestream. File lưu ở server/uploads, không commit vào repo.</p>
          <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMusic(f); }} />
          {tracks.map((t) => (
            <div key={t.file} className="comment">
              {t.name} <span className="muted">({Math.round(t.size / 1024)} KB)</span>
              <div className="row">
                <button className="btn small" onClick={() => { session.machine.requestMusic(); void session.audio.playMusic(t.url).catch(() => undefined); }}>Phát / hát nhép</button>
                <button className="btn small" onClick={() => { session.audio.stopMusic(); session.machine.transition('IDLE'); }}>Dừng</button>
              </div>
            </div>
          ))}
          {tracks.length === 0 && <p className="muted">Chưa có bài nhạc nào.</p>}
        </section>

        <section className="card">
          <h2>Lịch sử phiên</h2>
          <button className="btn" onClick={() => void loadAll()}>Tải lại</button>
          <button className="btn" onClick={async () => { await api.clearHistory(); setAdminMsg('Đã xóa lịch sử.'); await loadAll(); }}>Xóa lịch sử</button>
          {history.map((h) => (
            <div key={h.id} className="comment">
              <b>{h.name}</b>: {h.text}<br />
              <span className="reply">{h.reply || '(chưa trả lời)'}</span>
              <span className="muted small"> · {h.latencyMs != null ? `${h.latencyMs}ms` : ''} {h.mock ? '· MOCK_DEMO' : ''}</span>
            </div>
          ))}
          {history.length === 0 && <p className="muted">Chưa có lịch sử.</p>}
        </section>
      </div>)}
    </div>
  );
}
