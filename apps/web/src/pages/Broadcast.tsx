import { useState } from 'react';
import { AvatarCanvas, type BackgroundPreset } from '../components/AvatarCanvas';
import { useLiveSession } from '../components/useLiveSession';

/**
 * Broadcast Output — CLEAN page for OBS Browser Source (1080x1920, 9:16).
 * No admin menu, no controls except an audio toggle honoured via ?audio=off.
 * Audio + video come from this same page when opened as a Browser Source.
 */
export function BroadcastPage() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const audioParam = params.get('audio');
  const bgParam = params.get('bg') as BackgroundPreset | null;
  const [background] = useState<BackgroundPreset>(
    bgParam && ['podcast', 'bedroom', 'music', 'cafe', 'chat', 'office'].includes(bgParam) ? bgParam : 'office',
  );
  const [audioOn, setAudioOn] = useState(audioParam !== 'off');
  const session = useLiveSession({ autoSpeak: true, audioEnabled: audioOn });
  const latest = session.queue.find((i) => i.status === 'answered' && i.reply);

  return (
    <div className="broadcast">
      <AvatarCanvas anim={session.anim} background={background} onVrmStatus={() => undefined} lipSyncNote="" onLipSyncNote={() => undefined} />
      <div className="broadcast-overlay">
        <span className="ai-badge small">AI VIRTUAL · QUYÊN</span>
        <div className="broadcast-subtitle" aria-live="polite">
          {session.speakingText || latest?.reply || ''}
        </div>
        {session.speakingText === '' && latest?.reply && <div className="broadcast-name">{latest.name}</div>}
      </div>
      <button className="broadcast-audio-toggle" onClick={() => setAudioOn((v) => !v)} aria-label="Bật/tắt âm thanh">
        {audioOn ? '🔊' : '🔇'}
      </button>
    </div>
  );
}
