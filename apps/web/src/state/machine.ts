export type AvatarState =
  | 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'SINGING' | 'TRANSITION' | 'PAUSED' | 'ERROR';

export type AudioSourceKind = 'speech' | 'music' | 'none';

/** Allowed transitions. Anything else is rejected and logged by the caller. */
const ALLOWED: Record<AvatarState, AvatarState[]> = {
  IDLE: ['LISTENING', 'THINKING', 'SINGING', 'PAUSED', 'ERROR', 'TRANSITION', 'SPEAKING'],
  LISTENING: ['THINKING', 'IDLE', 'PAUSED', 'ERROR'],
  THINKING: ['SPEAKING', 'ERROR', 'IDLE', 'PAUSED'],
  SPEAKING: ['IDLE', 'LISTENING', 'ERROR', 'PAUSED', 'TRANSITION'],
  SINGING: ['LISTENING', 'THINKING', 'SPEAKING', 'IDLE', 'PAUSED', 'ERROR', 'TRANSITION'],
  TRANSITION: ['IDLE', 'SPEAKING', 'SINGING', 'ERROR'],
  PAUSED: ['IDLE', 'ERROR', 'TRANSITION'],
  ERROR: ['IDLE', 'PAUSED', 'TRANSITION'],
};

/**
 * Single-audio-source guard: at most one primary audio source plays at a time.
 * Music must be ducked/stopped before speech starts. This class is pure logic;
 * actual audio stop/duck lives in the audio manager, which consults this guard.
 */
export class AvatarStateMachine {
  private _state: AvatarState = 'IDLE';
  private _audio: AudioSourceKind = 'none';
  private listeners = new Set<(s: AvatarState) => void>();

  get state(): AvatarState { return this._state; }
  get audio(): AudioSourceKind { return this._audio; }

  onChange(fn: (s: AvatarState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit() { for (const fn of this.listeners) fn(this._state); }

  canTransition(to: AvatarState): boolean {
    return this._state === to || ALLOWED[this._state].includes(to);
  }

  transition(to: AvatarState): boolean {
    if (!this.canTransition(to)) return false;
    this._state = to;
    if (to === 'IDLE' || to === 'PAUSED' || to === 'ERROR') this._audio = 'none';
    this.emit();
    return true;
  }

  /** Request to start speech. Returns false if another speech is already playing. */
  requestSpeech(): boolean {
    if (this._audio === 'speech') return false;
    // Music must already have been ducked/stopped by the caller; record the switch.
    this._audio = 'speech';
    return this.transition('SPEAKING');
  }
  requestMusic(): boolean {
    if (this._audio === 'speech') return false;
    this._audio = 'music';
    return this.transition('SINGING');
  }
  endAudio(kind: AudioSourceKind) {
    if (this._audio === kind) this._audio = 'none';
    if (this._state === 'SPEAKING' || this._state === 'SINGING') this.transition('IDLE');
  }
  /** TTS failure: go ERROR, then the caller recovers to IDLE. */
  fail(error: string): AvatarState {
    void error;
    this._audio = 'none';
    this.transition('ERROR');
    return this._state;
  }
  recover() { return this.transition('IDLE'); }
}
