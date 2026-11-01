import { useEffect, useRef, useState } from 'react';
import { AvatarCanvas, BACKGROUNDS, type BackgroundPreset } from '../components/AvatarCanvas';
import { useLiveSession } from '../components/useLiveSession';
import { api, type MusicTrack } from '../lib/api';

export function LivePage() {
  const [name, setName] = useState('Minh');
  const [text, setText] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [background, setBackground] = useState<BackgroundPreset>('podcast');
  const [vrmStatus, setVrmStatus] = useState('checking');
  const [audioOn, setAudioOn] = useState(true);
  const [autoSing, setAutoSing] = useState(false);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [trackUrl, setTrackUrl] = useState('');
  const lastActivityRef = useRef(Date.now());
  const session = useLiveSession({ autoSpeak: true, audioEnabled: audioOn });
  const { health, queue, machineState, speakingText, errorMsg, anim, audio, lipSyncNote, setLipSyncNote } = session;

  useEffect(() => { api.music().then((r) => setTracks(r.items)).catch(() => undefined); }, []);
  useEffect(() => {
    if (queue.some((i) => i.status === 'answered')) lastActivityRef.current = Date.now();
  }, [queue]);

  // Idle entertainment: after 30s without an answer, sing a selected track.
  useEffect(() => {
    if (!autoSing || !trackUrl) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > 30_000 && audio.kind !== 'music' && machineState === 'IDLE') {
        session.machine.requestMusic();
        void audio.playMusic(trackUrl).catch(() => undefined);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoSing, trackUrl, audio, machineState, session.machine]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    lastActivityRef.current = Date.now();
    const r = await api.chat(name.trim() || 'Khách', text.trim());
    if (r.status === 202) { setSendMsg('Đã gửi — đang chờ AI xử lý.'); setText(''); }
    else setSendMsg(String(r.body.message || r.body.reason || 'Bình luận bị từ chối.'));
    void session.refresh();
  }

  const answered = queue.filter((i) => i.status === 'answered');
  const pending = queue.filter((i) => i.status === 'queued' || i.status === 'thinking');
  const latestAnswered = answered[answered.length - 1];

  return (
    <div className="live-layout">
      <header className="topbar">
        <a href="#/">← Trang chủ</a>
        <strong>Cô Linh — Giáo viên AI</strong>
        <span className="ai-badge small">AI · KHÔNG PHẢI NGƯỜI THẬT</span>
        <span className="muted">Trạng thái: {machineState}</span>
        <button className="btn small" onClick={() => setAudioOn((v) => !v)}>{audioOn ? 'Tắt tiếng' : 'Bật tiếng'}</button>
      </header>

      <div className="live-body">
        <section className="stage">
          <AvatarCanvas anim={anim} background={background} onVrmStatus={(s) => setVrmStatus(s)} lipSyncNote={lipSyncNote} onLipSyncNote={setLipSyncNote} />
          <div className="stage-footer">
            <div className="subtitle" aria-live="polite">{speakingText || (machineState === 'THINKING' ? 'Cô Linh đang suy nghĩ…' : machineState === 'SINGING' ? '♪ Đang hát nhép theo nhạc…' : 'Cô Linh đang lắng nghe — hãy gửi câu hỏi nhé!')}</div>
            <div className="muted small">
              {health?.llm.mock ? 'Chế độ DEMO: chưa có LLM key — câu trả lời có tiền tố [BẢN DEMO — chưa có LLM]. ' : 'LLM đã cấu hình. '}
              {health?.tts.configured ? 'Giọng: ElevenLabs (server).' : 'Giọng: demo SpeechSynthesis của trình duyệt.'}
              {' '}VRM: {vrmStatus}. TikTok: CHƯA KHẢ DỤNG.
            </div>
            {errorMsg && <div className="error-box" role="alert">{errorMsg} <button className="btn small" onClick={() => session.setErrorMsg('')}>Đóng</button></div>}
          </div>
        </section>

        <aside className="chat-panel">
          <h2>Câu hỏi của học sinh</h2>
          <label>Background
            <select value={background} onChange={(e) => setBackground(e.target.value as BackgroundPreset)}>
              {Object.entries(BACKGROUNDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={autoSing} onChange={(e) => setAutoSing(e.target.checked)} /> Tự hát nhép sau 30 giây không có bình luận</label>
          <label>Bài nhạc
            <select value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)}>
              <option value="">— Chưa chọn —</option>
              {tracks.map((t) => <option key={t.file} value={t.url}>{t.name}</option>)}
            </select>
          </label>
          {tracks.length === 0 && <p className="muted small">Thư viện nhạc trống. Quản trị tải file có quyền lên ở /admin → Thư viện nhạc.</p>}
          <div className="row">
            <button className="btn small" disabled={!trackUrl} onClick={() => { session.machine.requestMusic(); void audio.playMusic(trackUrl).catch(() => undefined); }}>Phát nhạc</button>
            <button className="btn small" onClick={() => { audio.stopMusic(); session.machine.transition('IDLE'); }}>Dừng nhạc</button>
            <button className="btn small" onClick={session.cancelSpeech}>Hủy câu trả lời đang nói</button>
          </div>

          {latestAnswered?.reply && (
            <div className="comment">
              <b>{latestAnswered.kind === 'lesson' ? `📖 Bài giảng: ${latestAnswered.text}` : `Câu trả lời mới nhất cho ${latestAnswered.name}`}</b><br />
              <span className="reply">{latestAnswered.reply}</span>
            </div>
          )}

          <div className="comments">
            {pending.map((i) => (
              <div key={i.id} className="comment pending"><b>{i.name}</b> <span className="muted">({i.source})</span><br />{i.text}<br /><span className="muted small">{i.status === 'thinking' ? 'AI đang suy nghĩ…' : 'Đang chờ…'}</span></div>
            ))}
            {answered.slice(0, 8).map((i) => (
              <div key={i.id} className="comment"><b>{i.name}</b>{i.kind === 'lesson' ? ' · BÀI GIẢNG' : ''}<br />{i.kind === 'lesson' ? `Bài giảng: ${i.text}` : i.text}<br /><span className="reply">Cô Linh: {i.reply}</span></div>
            ))}
            {queue.length === 0 && <p className="muted">Chưa có bình luận nào.</p>}
          </div>

          <form className="chat-form" onSubmit={send}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn" maxLength={40} aria-label="Tên của bạn" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nhập câu hỏi…" maxLength={500} aria-label="Câu hỏi" />
            <button className="btn primary" type="submit">Gửi</button>
          </form>
          {sendMsg && <p className="muted small" role="status">{sendMsg}</p>}
          <p className="muted small">Câu hỏi qua kiểm duyệt (chống spam/trùng lặp/giới hạn tốc độ). Không phải mọi câu hỏi đều được trả lời khi đông người xem.</p>
        </aside>
      </div>
    </div>
  );
}
