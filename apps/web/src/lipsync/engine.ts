/**
 * LipSyncEngine — common interface. Implementations must NOT depend on the
 * avatar type: the same engine drives the procedural fallback mouth and,
 * via the VRM adapter, real VRM viseme expressions.
 */
export type VisemeWeights = { aa: number; ih: number; ou: number; ee: number; oh: number };

export interface LipSyncEngine {
  readonly kind: string;
  /** Current mouth openness 0..1 (0 = fully closed). Must return 0 when silent/ended. */
  readonly mouthOpen: number;
  readonly volume: number;
  readonly visemes: VisemeWeights;
  /** Attach an AnalyserNode (or any source node) for analysis. */
  attachSource(node: AudioNode): void;
  /** Called every frame; returns current mouthOpen. */
  update(): number;
  dispose(): void;
}

export function emptyVisemes(): VisemeWeights {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
}

/**
 * Audio-driven fallback, written from scratch (no dependency).
 * AnalyserNode time-domain RMS -> mouthOpen, with smoothing and a silence
 * floor so the mouth closes fully when audio ends. Visemes are a coarse
 * approximation from frequency bands (low energy ~ aa/ou, high energy ~ ee/ih)
 * — honest approximation, not phoneme data.
 */
export class AnalyserLipSyncEngine implements LipSyncEngine {
  readonly kind = 'analyser-fallback';
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  private smoothed = 0;
  private _visemes: VisemeWeights = emptyVisemes();
  private _volume = 0;
  private lastNonSilentAt = 0;

  constructor(private ctx: AudioContext) {}

  attachSource(node: AudioNode) {
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.35;
    node.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
  }

  get mouthOpen() { return this.smoothed; }
  get volume() { return this._volume; }
  get visemes() { return this._visemes; }

  update(): number {
    if (!this.analyser || !this.freqData || !this.timeData) {
      this.decay();
      return this.smoothed;
    }
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.timeData.length);
    // Silence floor: RMS below ~0.015 counts as silent.
    const target = rms < 0.015 ? 0 : Math.min(1, (rms - 0.015) * 6);
    this._volume = target;
    if (target > 0) this.lastNonSilentAt = performance.now();
    // Fast attack, slower release; hard-close after 250ms of silence.
    const silentFor = performance.now() - this.lastNonSilentAt;
    if (silentFor > 250) {
      this.smoothed = 0;
    } else if (target > this.smoothed) {
      this.smoothed += (target - this.smoothed) * 0.55;
    } else {
      this.smoothed += (target - this.smoothed) * 0.25;
    }
    this.analyser.getByteFrequencyData(this.freqData);
    const n = this.freqData.length;
    const low = avg(this.freqData, 0, Math.floor(n * 0.15)) / 255;
    const mid = avg(this.freqData, Math.floor(n * 0.15), Math.floor(n * 0.5)) / 255;
    const high = avg(this.freqData, Math.floor(n * 0.5), n) / 255;
    const open = this.smoothed;
    this._visemes = {
      aa: open * (0.4 + 0.6 * low),
      ou: open * (0.3 + 0.5 * low),
      ee: open * (0.3 + 0.6 * high),
      ih: open * (0.3 + 0.5 * high),
      oh: open * (0.3 + 0.5 * mid),
    };
    return this.smoothed;
  }

  private decay() {
    this.smoothed *= 0.6;
    if (this.smoothed < 0.01) this.smoothed = 0;
    this._volume = 0;
    this._visemes = emptyVisemes();
  }
  dispose() { this.analyser?.disconnect(); this.analyser = null; }
}

function avg(data: ArrayLike<number>, from: number, to: number): number {
  if (to <= from) return 0;
  let s = 0;
  for (let i = from; i < to; i++) s += data[i];
  return s / (to - from);
}
