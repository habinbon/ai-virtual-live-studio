import { useEffect, useState } from 'react';
import { AvatarCanvas, BACKGROUNDS, type BackgroundPreset } from '../components/AvatarCanvas';
import { useLiveSession } from '../components/useLiveSession';
import { api } from '../lib/api';

export function LivePage() {
  const [name, setName] = useState('Minh');
  const [text, setText] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [background, setBackground] = useState<BackgroundPreset>('office');
  const [vrmStatus, setVrmStatus] = useState('checking');
  const [audioOn, setAudioOn] = useState(true);
  const [audioState, setAudioState] = useState('chưa tạo');
  const session = useLiveSession({ autoSpeak: true, audioEnabled: audioOn });
  const { health, queue, machineState, speakingText, errorMsg, anim, lipSyncNote, setLipSyncNote } = session;

  // On-page audio diagnostic: shows whether the browser actually lets
  // this page make sound (running = yes, suspended = locked by the phone).
  useEffect(() => {
    const id = window.setInterval(() => setAudioState(session.audio.contextState), 1000);
    return () => window.clearInterval(id);
  }, [session.audio]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
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
        <strong>Cô Quyên — Giáo viên AI</strong>
        <span className="ai-badge small">AI · KHÔNG PHẢI NGƯỜI THẬT</span>
        <span className="muted">Trạng thái: {machineState}</span>
        <button className="btn small" onClick={() => setAudioOn((v) => !v)}>{audioOn ? 'Tắt tiếng' : 'Bật tiếng'}</button>
        <button className="btn small" onClick={() => {
          void session.unlockAudio();
          void session.audio.speak('Xin chào, Quyên là nhân vật AI. Đây là kiểm tra âm thanh.', session.health?.tts ?? null)
            .catch((e) => session.setErrorMsg(`Lỗi thử tiếng: ${String((e as Error)?.message || e).slice(0, 200)}`));
        }}>Thử tiếng</button>
      </header>

      <div className="live-body">
        <section className="stage">
          <AvatarCanvas anim={anim} background={background} onVrmStatus={(s) => setVrmStatus(s)} lipSyncNote={lipSyncNote} onLipSyncNote={setLipSyncNote} />
          <div className="stage-footer">
            <div className="subtitle" aria-live="polite">{speakingText || (machineState === 'THINKING' ? 'Cô Quyên đang suy nghĩ…' : machineState === 'SINGING' ? '♪ Đang hát nhép theo nhạc…' : 'Cô Quyên đang lắng nghe — hãy gửi câu hỏi nhé!')}</div>
            <div className="muted small">
              {health?.llm.mock ? 'Chế độ DEMO: chưa có LLM key — câu trả lời có tiền tố [BẢN DEMO — chưa có LLM]. ' : 'LLM đã cấu hình. '}
              {health?.ttsProvider === 'voicetube' ? 'Giọng: VoiceTube (server).' : health?.ttsProvider === 'vieneu' ? 'Giọng: VieNeu (server).' : health?.tts.configured ? 'Giọng: ElevenLabs (server).' : 'Giọng: demo SpeechSynthesis của trình duyệt.'}
              {' '}VRM: {vrmStatus}. TikTok: CHƯA KHẢ DỤNG. Âm thanh: {audioState}.
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
          <div className="row">
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
              <div key={i.id} className="comment"><b>{i.name}</b>{i.kind === 'lesson' ? ' · BÀI GIẢNG' : ''}<br />{i.kind === 'lesson' ? `Bài giảng: ${i.text}` : i.text}<br /><span className="reply">Cô Quyên: {i.reply}</span></div>
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
