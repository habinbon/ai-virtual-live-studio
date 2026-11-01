/**
 * Optional MFCC lip-sync adapter for real VRM models (three-vrm-lip-sync, MIT).
 * Loaded with a dynamic import inside try/catch: if the package, its WASM, or
 * the secure-context AudioWorklet is unavailable, the caller MUST keep using
 * the AnalyserLipSyncEngine fallback and the build must not break.
 *
 * This adapter is only meaningful with a real VRM instance. With the
 * procedural fallback avatar it is never instantiated — do not report
 * "VRM lip-sync" when no VRM model is loaded.
 *
 * Wiring rule (fixed 2026-11-01): creating the driver is NOT enough — the
 * driver must be fed audio for every utterance. AudioManager feeds each
 * decoded TTS buffer through attachAnalysisBuffer() (analysis only, NOT
 * audible, so the speech is not played twice). When the driver has no active
 * source, the avatar falls back to writing 'aa' from the analyser's
 * mouthOpen (see AvatarCanvas).
 */
import type { VRM } from '@pixiv/three-vrm';
import type { LipSyncEngine, VisemeWeights } from './engine';
import { emptyVisemes } from './engine';

export interface VrmLipSyncDriver {
  /** The driver's currently attached source, or null when idle/ended. */
  readonly currentSource: unknown;
  /** Current viseme weights (copy). */
  readonly weights: VisemeWeights;
  /** Current normalized loudness, 0..1. */
  readonly volume: number;
  /** Write current weights into the model's viseme expressions (once/frame). */
  update(): void;
  /** Stop the current source (mouth eases shut via engine smoothing). */
  stop(): void;
  /** Stop the source and release audio resources. */
  dispose(): void;
  /**
   * Feed a decoded TTS buffer for ANALYSIS ONLY (audible: false).
   * The caller (AudioManager) already plays the same audio audibly through
   * its own graph — never use the driver's audible playBuffer() for TTS,
   * or the voice would play twice.
   */
  attachAnalysisBuffer(buffer: AudioBuffer): Promise<void>;
}

export type VrmLipSyncAdapterResult =
  | { ok: true; engine: LipSyncEngine; driver: VrmLipSyncDriver }
  | { ok: false; reason: string };

/** Single active driver, so AudioManager can feed it without prop drilling. */
let activeDriver: VrmLipSyncDriver | null = null;
export function registerVrmLipSyncDriver(driver: VrmLipSyncDriver | null): void {
  activeDriver = driver;
}
export function getVrmLipSyncDriver(): VrmLipSyncDriver | null {
  return activeDriver;
}

type RawDriver = {
  engine: { weights: VisemeWeights; volume: number };
  audioContext: AudioContext;
  currentSource: unknown;
  update: () => void;
  dispose: () => void;
  stop: () => void;
  attach: (source: unknown, opts?: { audible?: boolean }) => Promise<unknown>;
};

export async function tryCreateVrmLipSync(
  vrm: VRM,
  audioContext: AudioContext,
): Promise<VrmLipSyncAdapterResult> {
  try {
    if (!window.isSecureContext) {
      return { ok: false, reason: 'AudioWorklet cần secure context (localhost/HTTPS); window.isSecureContext=false.' };
    }
    const mod = await import('three-vrm-lip-sync');
    const raw = (await mod.VRMLipSync.create(vrm, { audioContext })) as unknown as RawDriver;
    const visemeNames: string[] =
      ((mod as unknown as { VISEME_NAMES?: string[] }).VISEME_NAMES ?? ['aa', 'ih', 'ou', 'ee', 'oh']);
    const driver: VrmLipSyncDriver = {
      get currentSource() {
        return raw.currentSource;
      },
      get weights(): VisemeWeights {
        return { ...raw.engine.weights };
      },
      get volume() {
        return raw.engine.volume;
      },
      update() {
        // Measured on real hardware 2026-11-01: after the source ends, the
        // MFCC engine FREEZES its last weights (aa stuck at 0.139 in the
        // PoC log) instead of decaying to 0, so raw.update() would re-write
        // the frozen value every frame and the mouth would stay slightly
        // open forever. Only let the driver write while it has an active
        // source; otherwise release the visemes ourselves, ~0.05/frame.
        if (raw.currentSource) {
          raw.update();
          return;
        }
        const em = vrm.expressionManager;
        if (!em) return;
        try {
          for (const name of visemeNames) {
            const cur = Number(em.getValue(name) ?? 0);
            if (cur > 0) em.setValue(name, Math.max(0, cur - 0.05));
          }
        } catch { /* expression read/write failed; leave values as-is */ }
      },
      stop() {
        raw.stop();
      },
      dispose() {
        raw.dispose();
      },
      async attachAnalysisBuffer(buffer: AudioBuffer) {
        const source = mod.createBufferSource(raw.audioContext, buffer);
        await raw.attach(source, { audible: false });
      },
    };
    const engine: LipSyncEngine = {
      kind: 'three-vrm-lip-sync (MFCC)',
      get mouthOpen() {
        const w = raw.engine.weights;
        return Math.max(w.aa, w.ih, w.ou, w.ee, w.oh, raw.engine.volume);
      },
      get volume() {
        return raw.engine.volume;
      },
      get visemes(): VisemeWeights {
        return { ...raw.engine.weights };
      },
      attachSource() {
        /* VRMLipSync drives playback itself via playUrl/playBuffer/attach */
      },
      update() {
        raw.update();
        const w = raw.engine.weights;
        return Math.max(w.aa, w.ih, w.ou, w.ee, w.oh, raw.engine.volume);
      },
      dispose() {
        raw.dispose();
      },
    };
    void emptyVisemes;
    return { ok: true, engine, driver };
  } catch (e) {
    return { ok: false, reason: `Không khởi tạo được three-vrm-lip-sync: ${String((e as Error)?.message || e).slice(0, 200)}` };
  }
}
