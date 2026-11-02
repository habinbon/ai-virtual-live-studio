import { AnalyserLipSyncEngine } from '../lipsync/engine';
import { getVrmLipSyncDriver } from '../lipsync/vrmAdapter';
import type { AvatarAnimState } from './animState';

/**
 * Single-main-audio-source manager.
 * - speech: ElevenLabs audio (via /api/tts) when configured, else browser
 *   SpeechSynthesis (demo). SpeechSynthesis has no audio node, so mouth
 *   movement is simulated with a timer while the utterance is active — the UI
 *   labels this honestly as demo mode.
 * - music: an <audio> element routed through MediaElementSource -> Analyser ->
 *   destination, so singing lip-sync follows the real uploaded file.
 * Only one of speech/music plays at a time; starting speech stops/ducks music.
 */
export type TtsStatus = {
  configured: boolean; provider: string; voiceId: string; model: string; languageCode: string; note: string;
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private speechGain: GainNode | null = null;
  private engine: AnalyserLipSyncEngine | null = null;
  private speechSource: AudioBufferSourceNode | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private speechSynthesisActive = false;
  private simTimer: number | null = null;
  private currentKind: 'none' | 'speech' | 'music' = 'none';
  lastLatency: { ttsFetchMs: number | null; playToFirstVisemeMs: number | null; startedAt: number } | null = null;

  constructor(private anim: AvatarAnimState, private onEnded: (kind: 'speech' | 'music') => void) {}

  get kind() { return this.currentKind; }

  /** AudioContext state for the on-page diagnostic line ('running' = can sound). */
  get contextState(): string {
    return this.ctx ? this.ctx.state : 'chưa tạo';
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.7;
      this.musicGain.connect(this.master);
      this.speechGain = this.ctx.createGain();
      this.speechGain.gain.value = 1;
      this.speechGain.connect(this.master);
      this.engine = new AnalyserLipSyncEngine(this.ctx);
      // Engine analyses the speech bus; music attaches its own analyser node
      // via the shared engine by reconnecting when music starts (see playMusic).
      this.engine.attachSource(this.speechGain);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Unlock audio on mobile browsers: MUST be called from a user gesture
   * (tap/keypress). Phone browsers (iOS Safari, Android Chrome) create the
   * AudioContext suspended and ignore resume() outside a gesture, so
   * speech started from a poll timer stays silent without this. */
  async unlockAudio(): Promise<void> {
    try {
      const ctx = this.ensureCtx();
      if (ctx.state === 'suspended') await ctx.resume();
    } catch { /* audio stays locked until the next gesture */ }
    try { window.speechSynthesis?.getVoices?.(); } catch { /* no speechSynthesis */ }
    try { await getVrmLipSyncDriver()?.unlock?.(); } catch { /* driver unlock failed */ }
  }

  /** Called every frame by the avatar: updates mouthOpen from the analyser. */
  updateLipSync(): number {
    if (this.currentKind === 'speech' && this.speechSynthesisActive) {
      // Simulated mouth for SpeechSynthesis demo (no audio node available).
      return this.anim.mouthOpen;
    }
    if (!this.engine) return 0;
    const open = this.engine.update();
    this.anim.mouthOpen = open;
    return open;
  }

  stopAll() {
    this.stopSpeech();
    this.stopMusic();
  }

  private stopSpeech() {
    try { this.speechSource?.stop(); } catch { /* already stopped */ }
    this.speechSource = null;
    // Release the MFCC driver's analysis source too, so the mouth eases shut
    // instead of holding the last viseme. Non-fatal if no driver is active.
    try { getVrmLipSyncDriver()?.stop(); } catch { /* no driver */ }
    if (this.speechSynthesisActive) {
      window.speechSynthesis.cancel();
      this.speechSynthesisActive = false;
    }
    if (this.simTimer !== null) { window.clearInterval(this.simTimer); this.simTimer = null; }
    if (this.currentKind === 'speech') this.currentKind = 'none';
    this.anim.speaking = false;
  }

  stopMusic() {
    if (this.musicEl) { this.musicEl.pause(); this.musicEl.currentTime = 0; }
    if (this.currentKind === 'music') this.currentKind = 'none';
    this.anim.singing = false;
    this.anim.energy = 0.3;
  }

  duckMusic(to = 0.12) {
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(to, this.ctx.currentTime, 0.15);
    }
  }
  restoreMusic() {
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(0.7, this.ctx.currentTime, 0.3);
    }
  }

  /** Speak text. Returns {mode:'elevenlabs'|'speechSynthesis', ...}. */
  async speak(text: string, ttsStatus: TtsStatus | null): Promise<{ mode: string; latencyMs: number | null }> {
    this.stopAll();
    this.anim.speaking = true;
    this.currentKind = 'speech';
    const fetchStarted = performance.now();
    if (ttsStatus?.configured) {
      try {
        const ctx = this.ensureCtx();
        const res = await fetch('/api/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(buf);
        // Await the resume, but never hang on it: on iOS WebKit resume()
        // can stay pending forever without a fresh gesture, which would
        // stall speech entirely. Race with a short timeout; a source
        // started while suspended sounds as soon as a later tap unlocks.
        try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]); } catch { /* still suspended; a later gesture unlocks */ }
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(this.speechGain!);
        // Feed the SAME decoded buffer to the MFCC driver for ANALYSIS ONLY
        // (audible: false inside the adapter). The driver must never play
        // it audibly here, or the voice would sound twice. If no driver is
        // registered (fallback avatar / MFCC unavailable), this is a no-op
        // and the analyser fallback drives the mouth instead. Never let a
        // driver failure break speech.
        try {
          const driver = getVrmLipSyncDriver();
          if (driver) {
            // Same hang guard as the resume above: never let the driver
            // unlock stall speech on iOS WebKit.
            await Promise.race([driver.unlock(), new Promise((r) => setTimeout(r, 300))]);
            await driver.attachAnalysisBuffer(audioBuf);
          }
        } catch { /* MFCC feeding failed; analyser fallback still applies */ }
        // Re-attach analyser to the speech bus (already attached) and track
        // time from play() to first visible viseme for the PoC log.
        const playAt = ctx.currentTime;
        const startedPerf = performance.now();
        src.onended = () => {
          this.anim.mouthOpen = 0;
          this.anim.speaking = false;
          this.currentKind = 'none';
          this.onEnded('speech');
        };
        src.start();
        this.speechSource = src;
        // Poll until mouth opens; record first-viseme latency.
        const poll = window.setInterval(() => {
          const open = this.engine?.update() ?? 0;
          if (open > 0.05 || !this.speechSource) {
            this.lastLatency = {
              ttsFetchMs: Math.round(startedPerf - fetchStarted),
              playToFirstVisemeMs: open > 0.05 ? Math.round((ctx.currentTime - playAt) * 1000) : null,
              startedAt: Date.now(),
            };
            window.clearInterval(poll);
          }
        }, 30);
        window.setTimeout(() => window.clearInterval(poll), 5000);
        return { mode: 'elevenlabs', latencyMs: Math.round(startedPerf - fetchStarted) };
      } catch (e) {
        this.anim.speaking = false;
        this.currentKind = 'none';
        throw e;
      }
    }
    // Demo fallback: browser SpeechSynthesis, simulated mouth movement.
    this.speechSynthesisActive = true;
    const startedPerf = performance.now();
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'vi-VN';
      utter.rate = 1.0;
      let firstTick = true;
      this.simTimer = window.setInterval(() => {
        // Syllable-ish oscillation while speaking; mouth fully closes on end.
        this.anim.mouthOpen = 0.25 + Math.random() * 0.55;
        if (firstTick) {
          this.lastLatency = { ttsFetchMs: null, playToFirstVisemeMs: Math.round(performance.now() - startedPerf), startedAt: Date.now() };
          firstTick = false;
        }
      }, 110);
      utter.onend = () => {
        if (this.simTimer !== null) window.clearInterval(this.simTimer);
        this.simTimer = null;
        this.speechSynthesisActive = false;
        this.anim.mouthOpen = 0;
        this.anim.speaking = false;
        this.currentKind = 'none';
        this.onEnded('speech');
      };
      utter.onerror = () => {
        if (this.simTimer !== null) window.clearInterval(this.simTimer);
        this.simTimer = null;
        this.speechSynthesisActive = false;
        this.anim.mouthOpen = 0;
        this.anim.speaking = false;
        this.currentKind = 'none';
        this.onEnded('speech');
      };
      window.speechSynthesis.speak(utter);
      resolve({ mode: 'speechSynthesis-demo', latencyMs: null });
    });
  }

  /** Play a music file (uploaded, licensed) with real audio-driven lip-sync. */
  async playMusic(url: string, volume = 0.7): Promise<void> {
    this.stopSpeech();
    const ctx = this.ensureCtx();
    if (!this.musicEl) {
      this.musicEl = new Audio();
      this.musicEl.crossOrigin = 'anonymous';
      this.musicSource = ctx.createMediaElementSource(this.musicEl);
      this.musicSource.connect(this.musicGain!);
    }
    if (this.musicEl.src !== new URL(url, window.location.href).href) {
      this.musicEl.src = url;
    }
    // Route music through the analyser too: connect music gain to a tap.
    // The engine already analyses the speech bus; for music we add a second
    // analyser tap by reusing the same engine instance via a gain tap node.
    // Simpler and robust: attach a dedicated tap if not yet attached.
    if (this.musicGain && !(this.musicGain as unknown as { __tap?: boolean }).__tap) {
      const tap = ctx.createGain();
      tap.gain.value = 1;
      this.musicGain.connect(tap);
      this.engine?.attachSource(tap);
      (this.musicGain as unknown as { __tap?: boolean }).__tap = true;
    }
    if (this.musicGain) this.musicGain.gain.value = volume;
    this.musicEl.loop = true;
    this.musicEl.currentTime = 0;
    await this.musicEl.play();
    this.currentKind = 'music';
    this.anim.singing = true;
    this.anim.energy = 0.8;
    this.musicEl.onended = () => {
      if (this.currentKind === 'music') { this.currentKind = 'none'; this.anim.singing = false; this.onEnded('music'); }
    };
  }

  /** Stop music because a comment must be answered (spec §6.3). */
  interruptMusicForSpeech() {
    this.duckMusic(0);
    this.stopMusic();
  }
}
