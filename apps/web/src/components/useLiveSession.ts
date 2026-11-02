import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Health, type QueueItem } from '../lib/api';
import { AvatarStateMachine, type AvatarState } from '../state/machine';
import { AudioManager } from '../audio/playback';
import { createAnimState, type AvatarAnimState } from '../audio/animState';

export function useLiveSession(opts: { autoSpeak: boolean; audioEnabled: boolean }) {
  const anim: AvatarAnimState = useMemo(() => createAnimState(), []);
  const machineRef = useRef<AvatarStateMachine | null>(null);
  if (!machineRef.current) machineRef.current = new AvatarStateMachine();
  const machine = machineRef.current;

  const [machineState, setMachineState] = useState<AvatarState>('IDLE');
  const [health, setHealth] = useState<Health | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [speakingText, setSpeakingText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [lipSyncNote, setLipSyncNote] = useState<string>('Lip-sync: analyser fallback (audio-driven) — miệng đóng hẳn khi audio kết thúc.');
  const spokenRef = useRef<Set<string>>(new Set());
  const speakingRef = useRef(false);
  const audioRef = useRef<AudioManager | null>(null);

  useEffect(() => machine.onChange(setMachineState), [machine]);

  const audio = useMemo(() => {
    if (!audioRef.current) {
      audioRef.current = new AudioManager(anim, () => {
        speakingRef.current = false;
        machine.endAudio('speech');
        setSpeakingText('');
      });
    }
    return audioRef.current;
  }, [anim, machine]);

  // Lip-sync pump: runs every animation frame via rAF.
  useEffect(() => {
    let raf = 0;
    const loop = () => { audio.updateLipSync(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audio]);

  // Occasional glance down at comments.
  useEffect(() => {
    const id = window.setInterval(() => {
      anim.lookDown = true;
      window.setTimeout(() => { anim.lookDown = false; }, 2600);
    }, 14000);
    return () => window.clearInterval(id);
  }, [anim]);

  const refresh = useCallback(async () => {
    try {
      const [h, q] = await Promise.all([api.health(), api.queue()]);
      setHealth(h);
      setQueue(q.items);
      if (h.flags.paused) machine.transition('PAUSED');
      else if (!h.flags.aiRunning) machine.transition('PAUSED');
      else if (machine.state === 'PAUSED' && !speakingRef.current) machine.recover();
      if (h.lastError) setErrorMsg(h.lastError.message);
    } catch { /* keep last known state; avatar keeps idle animation */ }
  }, [machine]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 1500);
    return () => window.clearInterval(id);
  }, [refresh]);

  const speak = useCallback(async (text: string): Promise<boolean> => {
    if (!opts.audioEnabled) return false;
    if (speakingRef.current) return false;
    speakingRef.current = true;
    machine.transition('THINKING');
    setSpeakingText(text);
    const ok = machine.requestSpeech();
    if (!ok) { speakingRef.current = false; return false; }
    try {
      await audio.speak(text, health?.tts ?? null);
    } catch (e) {
      const msg = `Lỗi TTS: ${String((e as Error)?.message || e).slice(0, 200)} — đã phục hồi về trạng thái chờ.`;
      setErrorMsg(msg);
      machine.fail(msg);
      setSpeakingText('');
      speakingRef.current = false;
      window.setTimeout(() => machine.recover(), 1500);
    }
    return true;
  }, [audio, health, machine, opts.audioEnabled]);

  // Auto-speak the newest answered item once. The item is marked spoken
  // only after speech actually STARTS: if another utterance is playing,
  // the answer waits for the next poll instead of being skipped forever
  // (on phones the answer often arrives while the user is mid-tap or
  // the tab is backgrounded, where starting speech would be silent).
  useEffect(() => {
    if (!opts.autoSpeak || !opts.audioEnabled) return;
    if (document.hidden) return; // background tab: retry when visible again
    const answered = queue
      .filter((i) => i.status === 'answered' && i.reply && !spokenRef.current.has(i.id))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (!answered || !answered.reply) return;
    // If music is playing, the AudioManager stops it before speaking (single source).
    if (audio.kind === 'music') audio.interruptMusicForSpeech();
    void speak(answered.reply).then((started) => {
      if (started) spokenRef.current.add(answered.id);
    });
  }, [queue, opts.autoSpeak, opts.audioEnabled, audio, speak]);

  const cancelSpeech = useCallback(() => {
    audio.stopAll();
    speakingRef.current = false;
    machine.transition('IDLE');
    setSpeakingText('');
  }, [audio, machine]);

  const unlockAudio = useCallback(() => {
    void audio.unlockAudio();
  }, [audio]);

  // Mobile browsers suspend AudioContext until a user gesture. Unlock on
  // every tap/keypress so speech actually sounds on phones; the context
  // stays running afterwards, and a later tap re-unlocks it if the OS
  // suspends it again (phone call, tab switch).
  useEffect(() => {
    const unlock = () => { void audio.unlockAudio(); };
    const onVisible = () => { if (!document.hidden) unlock(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    // Returning to the tab (after it was backgrounded, where phone
    // browsers mute/suspend audio) re-unlocks so a waiting answer can
    // sound instead of playing silently in the background.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', unlock);
    window.addEventListener('focus', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', unlock);
      window.removeEventListener('focus', unlock);
    };
  }, [audio]);

  return {
    anim, machine, machineState, health, queue, speakingText, errorMsg, setErrorMsg,
    lipSyncNote, setLipSyncNote, audio, refresh, speak, cancelSpeech, spokenRef, unlockAudio,
  };
}
