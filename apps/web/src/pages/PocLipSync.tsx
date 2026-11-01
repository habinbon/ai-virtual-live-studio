import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { tryCreateVrmLipSync, registerVrmLipSyncDriver } from '../lipsync/vrmAdapter';

/**
 * PoC harness ONLY (not part of the shipped live/admin UI).
 * Loads /models/character.vrm, feeds the real Linh Sensei sample audio to
 * three-vrm-lip-sync (MFCC), and records viseme weights + expression values
 * before, during, and after playback. Results are rendered as text on the
 * page so a browser check can read them without guessing from pixels.
 * Route: #/poc-lipsync
 */

type Weights = { aa: number; ih: number; ou: number; ee: number; oh: number };
type Driver = {
  engine: { weights: Weights; volume: number };
  currentSource: unknown;
  update: () => void;
  dispose: () => void;
  playUrl: (url: string) => Promise<{ ended: Promise<void> }>;
  stop: () => void;
};

const ZERO: Weights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
const fmt = (w: Weights) =>
  `aa=${w.aa.toFixed(3)} ih=${w.ih.toFixed(3)} ou=${w.ou.toFixed(3)} ee=${w.ee.toFixed(3)} oh=${w.oh.toFixed(3)}`;

function VrmScene({
  vrmRef,
  driverRef,
  blinkSignalRef,
  armDown,
}: {
  vrmRef: React.MutableRefObject<VRM | null>;
  driverRef: React.MutableRefObject<Driver | null>;
  blinkSignalRef: React.MutableRefObject<number>;
  armDown: boolean;
}) {
  // Blink state (same timing as the live page: every 2.2–5.5s, ~120ms
  // close). The harness previously had NO idle/blink code at all, so the
  // character correctly never blinked here — that was a harness gap, not
  // a model problem. blinkSignalRef forces one blink for the blink test.
  const blink = useRef({ t: 0, next: 2.5, closing: 0 });
  // Gentle idle motion (head drift + breathing) + optional arm-rest pose.
  // Sky's rest pose is a T-pose: upper arms point sideways (+/-X, identity
  // rotations up the chain), so lowering the arms is a rotation about the
  // bone-local Z axis: left +~72deg, right -~72deg (verified from the
  // file's node translations; visual confirmation still required).
  const idleT = useRef(0);
  useFrame((_, delta) => {
    const vrm = vrmRef.current;
    if (!vrm) return;
    idleT.current += delta;
    const t = idleT.current;
    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y = Math.sin(t * 0.4) * 0.06;
      head.rotation.x = Math.sin(t * 0.7) * 0.02;
    }
    const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
    if (spine) spine.rotation.x = Math.sin(t * 1.4) * 0.02;
    const sway = Math.sin(t * 0.5) * 0.02;
    const lArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const rArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    // Dấu xoay này đúng với Twist (VRM 1.0); ngược dấu với Sky (VRM 0.x).
    if (lArm) lArm.rotation.z = armDown ? -1.25 - sway : 0;
    if (rArm) rArm.rotation.z = armDown ? 1.25 + sway : 0;
    const em = (vrm as unknown as { expressionManager?: { setValue?: (n: string, v: number) => void } }).expressionManager;
    if (em?.setValue) {
      const b = blink.current;
      b.t += delta;
      if (blinkSignalRef.current > 0) {
        blinkSignalRef.current -= 1;
        b.closing = 0.25;
      } else if (b.t > b.next) {
        b.closing = 0.12;
        b.next = b.t + 2.2 + Math.random() * 3.3;
      }
      if (b.closing > 0) {
        b.closing -= delta;
        em.setValue('blink', 0.92);
      } else {
        em.setValue('blink', 0);
      }
    }
    const d = driverRef.current;
    if (d) {
      // Same release rule as the app adapter: the MFCC engine freezes its
      // last weights after the source ends (PoC log 2026-11-01: aa stuck
      // at 0.139), so only call update() while a source is active, and
      // decay the visemes to 0 ourselves once the source is gone.
      if (d.currentSource) d.update();
      else {
        const em = (vrm as unknown as { expressionManager?: { getValue?: (n: string) => number | undefined; setValue?: (n: string, v: number) => void } }).expressionManager;
        if (em?.getValue && em?.setValue) {
          for (const name of ['aa', 'ih', 'ou', 'ee', 'oh'] as const) {
            const cur = Number(em.getValue(name) ?? 0);
            if (cur > 0) em.setValue(name, Math.max(0, cur - 0.05));
          }
        }
      }
    }
    vrm.update(delta);
  });
  const vrm = vrmRef.current;
  if (!vrm) return null;
  // DO NOT pass rotation={[0,0,0]} here: R3F would write it onto
  // vrm.scene and clobber the rotation.y = PI that VRMUtils.rotateVRM0
  // set for this VRM 0.x model (that prop is exactly why the character
  // still faced away after the rotateVRM0 fix). The scene's own rotation
  // is the source of truth; position alone is safe to pass.
  return <primitive object={vrm.scene} position={[0, -0.55, 0]} />;
}

function emValues(vrm: VRM | null): Weights {
  if (!vrm) return { ...ZERO };
  try {
    const em = (vrm as unknown as { expressionManager?: { getValue?: (n: string) => number | undefined } }).expressionManager;
    if (!em?.getValue) return { ...ZERO };
    return {
      aa: Number(em.getValue('aa') ?? 0),
      ih: Number(em.getValue('ih') ?? 0),
      ou: Number(em.getValue('ou') ?? 0),
      ee: Number(em.getValue('ee') ?? 0),
      oh: Number(em.getValue('oh') ?? 0),
    };
  } catch {
    return { ...ZERO };
  }
}

export function PocLipSyncPage() {
  const [status, setStatus] = useState('Chưa tải model. Bấm "Tải model" rồi "Chạy test".');
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const vrmRef = useRef<VRM | null>(null);
  const driverRef = useRef<Driver | null>(null);
  const blinkSignalRef = useRef(0);
  const [armDown, setArmDown] = useState(false);
  const [, forceRender] = useState(0);
  const resultRef = useRef<Record<string, unknown>>({});

  const addLog = (line: string) => setLog((prev) => [...prev, line]);

  useEffect(() => {
    return () => {
      driverRef.current?.dispose();
      driverRef.current = null;
    };
  }, []);

  // Headless/CI mode: #/poc-lipsync?auto=1 runs load + test without clicks
  // (AudioContext autoplay is allowed by the headless flags used for the run).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (!window.location.hash.includes('auto=1')) return;
    autoStarted.current = true;
    let cancelled = false;
    (async () => {
      await loadModel();
      const t0 = Date.now();
      while (!cancelled && !vrmRef.current && Date.now() - t0 < 15000) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!cancelled && vrmRef.current) await runTest();
    })();
    return () => {
      cancelled = true;
    };
    // loadModel/runTest are stable-enough closures for this harness; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadModel() {
    setStatus('Đang tải /models/character.vrm…');
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync('/models/character.vrm');
      const loaded = gltf.userData.vrm as VRM | undefined;
      if (!loaded) throw new Error('File không chứa VRM hợp lệ (gltf.userData.vrm trống).');
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      // VRM 0.x models face away from a +Z camera unless rotated (three-vrm
      // rotateVRM0 sets scene.rotation.y = PI for metaVersion "0"; no-op for
      // VRM 1.0). Without this, the harness showed the character's back.
      VRMUtils.rotateVRM0(loaded);
      vrmRef.current = loaded;
      const em = (loaded as unknown as { expressionManager?: unknown }).expressionManager;
      addLog(`MODEL LOADED: expressions manager = ${em ? 'có' : 'KHÔNG CÓ'}; đã xoay model về phía camera (rotateVRM).`);
      addLog(`CONTROL (trước khi phát audio): engine weights chưa có driver; em = ${fmt(emValues(loaded))}`);
      setStatus('Model đã tải. Bấm "Chạy test" (cần 1 cú bấm để mở AudioContext).');
      forceRender((n) => n + 1);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      addLog(`MODEL LOAD ERROR: ${msg}`);
      setStatus(`Lỗi tải model: ${msg}`);
    }
  }

  async function runTest() {
    const vrm = vrmRef.current;
    if (!vrm) {
      setStatus('Chưa có model — bấm "Tải model" trước.');
      return;
    }
    if (running) return;
    setRunning(true);
    setStatus('Đang chạy test MFCC…');
    try {
      driverRef.current?.dispose();
      driverRef.current = null;
      const mod = await import('three-vrm-lip-sync');
      const driver = (await mod.VRMLipSync.create(vrm, {})) as unknown as Driver;
      driverRef.current = driver;
      addLog(`DRIVER CREATED: three-vrm-lip-sync VRMLipSync.create OK. weights ban đầu = ${fmt(driver.engine.weights)} volume=${driver.engine.volume.toFixed(3)}`);

      const max: Weights = { ...ZERO };
      let firstAbove: number | null = null;
      let framesAbove = 0;
      let framesTotal = 0;
      const t0 = performance.now();
      const sampler = window.setInterval(() => {
        const w = driver.engine.weights;
        framesTotal += 1;
        (Object.keys(max) as (keyof Weights)[]).forEach((k) => {
          if (w[k] > max[k]) max[k] = w[k];
        });
        const mouth = Math.max(w.aa, w.ih, w.ou, w.ee, w.oh);
        if (mouth > 0.05) {
          framesAbove += 1;
          if (firstAbove === null) firstAbove = performance.now() - t0;
        }
      }, 50);

      addLog(`PLAY START: playUrl('/poc-audio/linh-sensei.mp3') tại t0. Audio dài ~5,92 giây.`);
      const source = await driver.playUrl('/poc-audio/linh-sensei.mp3');
      await source.ended;
      const tEnd = performance.now();
      addLog(`PLAY ENDED sau ${Math.round(tEnd - t0)} ms. max weights trong lúc phát: ${fmt(max)}; frames>0.05: ${framesAbove}/${framesTotal}; first>0.05 sau ${firstAbove === null ? 'KHÔNG BAO GIỜ' : `${Math.round(firstAbove)} ms`}.`);
      addLog(`EM tại lúc kết thúc: ${fmt(emValues(vrm))}`);

      const after: Record<string, string> = {};
      for (const delay of [250, 500, 1000]) {
        await new Promise((r) => setTimeout(r, delay === 250 ? 250 : delay === 500 ? 250 : 500));
        const elapsed = Math.round(performance.now() - tEnd);
        after[`+${delay}ms`] = fmt(emValues(vrm));
        addLog(`EM sau khi audio kết thúc +${elapsed} ms: ${fmt(emValues(vrm))} (weights engine: ${fmt(driver.engine.weights)})`);
      }
      window.clearInterval(sampler);
      const mouthAfter1s = Math.max(...Object.values(emValues(vrm)));
      const passed = framesAbove > 0 && mouthAfter1s < 0.05;
      resultRef.current = {
        max,
        firstAboveMs: firstAbove,
        framesAbove,
        framesTotal,
        emAfter1000ms: after['+1000ms'],
        mouthAfter1s,
        passed,
      };
      (window as unknown as { __pocResult?: unknown }).__pocResult = resultRef.current;
      document.title = passed ? 'POC-DONE-PASS' : 'POC-DONE-FAIL';
      setStatus(
        passed
          ? 'TEST XONG: miệng có cử động theo audio và đóng lại sau khi hết audio.'
          : 'TEST XONG: CÓ VẤN ĐỀ — xem log (miệng không cử động, hoặc không đóng sau khi hết audio).',
      );
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      addLog(`TEST ERROR: ${msg}`);
      setStatus(`Lỗi test: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  /**
   * Test 3 — the exact live-page path: driver via the app adapter, audio
   * decoded in a SEPARATE AudioContext (like AudioManager), fed with
   * attachAnalysisBuffer (analysis only, no audible playback from the
   * driver). Validates the cross-context buffer feeding that #/live uses.
   */
  async function runAttachTest() {
    const vrm = vrmRef.current;
    if (!vrm) {
      setStatus('Chưa có model — bấm "Tải model" trước.');
      return;
    }
    if (running) return;
    setRunning(true);
    setStatus('Đang chạy test nối buffer (đường trang live)…');
    try {
      driverRef.current?.dispose();
      driverRef.current = null;
      const r = await tryCreateVrmLipSync(vrm, new AudioContext());
      if (!r.ok) {
        addLog(`ATTACH TEST: tryCreateVrmLipSync FAILED: ${r.reason}`);
        setStatus(`Test nối buffer thất bại ở bước tạo driver: ${r.reason}`);
        return;
      }
      const driver = r.driver;
      registerVrmLipSyncDriver(driver);
      // VrmScene calls update() on driverRef; point it at this driver.
      driverRef.current = driver as unknown as Driver;
      addLog('ATTACH TEST: driver tạo qua adapter OK và đã đăng ký (registerVrmLipSyncDriver).');
      // Simulate AudioManager: fetch + decode in a different AudioContext.
      const playCtx = new AudioContext();
      const res = await fetch('/poc-audio/linh-sensei.mp3');
      const buf = await playCtx.decodeAudioData(await res.arrayBuffer());
      addLog(`ATTACH TEST: đã decode buffer trong AudioContext riêng (dài ${buf.duration.toFixed(2)} giây). Đang cấp buffer cho driver (analysis only)…`);
      const t0 = performance.now();
      await driver.attachAnalysisBuffer(buf);
      const max: Weights = { ...ZERO };
      let firstAbove: number | null = null;
      let framesAbove = 0;
      let framesTotal = 0;
      const sampler = window.setInterval(() => {
        const w = driver.weights;
        framesTotal += 1;
        (Object.keys(max) as (keyof Weights)[]).forEach((k) => {
          if (w[k] > max[k]) max[k] = w[k];
        });
        if (Math.max(w.aa, w.ih, w.ou, w.ee, w.oh) > 0.05) {
          framesAbove += 1;
          if (firstAbove === null) firstAbove = performance.now() - t0;
        }
      }, 50);
      // Audio is ~5.92s; wait 7s from attach, then sample mouth release.
      await new Promise((rr) => setTimeout(rr, 7000));
      window.clearInterval(sampler);
      addLog(`ATTACH TEST sau ~7 giây: max weights = ${fmt(max)}; frames>0.05: ${framesAbove}/${framesTotal}; first>0.05 sau ${firstAbove === null ? 'KHÔNG BAO GIỜ' : `${Math.round(firstAbove)} ms`}. EM lúc này: ${fmt(emValues(vrm))}`);
      for (const wait of [250, 500, 1000]) {
        await new Promise((rr) => setTimeout(rr, wait === 250 ? 250 : wait === 500 ? 250 : 500));
        addLog(`ATTACH TEST EM +${wait} ms sau mốc 7 giây: ${fmt(emValues(vrm))}`);
      }
      const mouthAfter = Math.max(...Object.values(emValues(vrm)));
      const passed = framesAbove > 0 && mouthAfter < 0.05;
      (window as unknown as { __pocAttachResult?: unknown }).__pocAttachResult = { max, firstAboveMs: firstAbove, framesAbove, framesTotal, mouthAfter, passed };
      document.title = passed ? 'POC-ATTACH-DONE-PASS' : 'POC-ATTACH-DONE-FAIL';
      setStatus(
        passed
          ? 'TEST NỐI BUFFER XONG: miệng cử động theo buffer và đóng lại sau đó.'
          : 'TEST NỐI BUFFER XONG: CÓ VẤN ĐỀ — xem log.',
      );
      await playCtx.close().catch(() => undefined);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      addLog(`ATTACH TEST ERROR: ${msg}`);
      setStatus(`Lỗi test nối buffer: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  /** Test 4 — blink: force one blink, then read the 'blink' expression value
   *  during the close and after it releases. Proves the expression exists
   *  and moves on this model, without needing to catch a 120ms blink by eye.
   */
  async function blinkTest() {
    const vrm = vrmRef.current;
    if (!vrm) {
      setStatus('Chưa có model — bấm "Tải model" trước.');
      return;
    }
    const blinkValue = () => {
      try {
        const em = (vrm as unknown as { expressionManager?: { getValue?: (n: string) => number | undefined } }).expressionManager;
        return Number(em?.getValue?.('blink') ?? NaN);
      } catch {
        return NaN;
      }
    };
    setStatus('Đang test chớp mắt…');
    addLog(`BLINK TEST: giá trị blink trước khi ra lệnh = ${blinkValue().toFixed(3)} (0 = mở mắt).`);
    blinkSignalRef.current += 1;
    await new Promise((rr) => setTimeout(rr, 90));
    const during = blinkValue();
    addLog(`BLINK TEST: giá trị blink lúc đang nhắm = ${during.toFixed(3)} (mong đợi khoảng 0.92).`);
    await new Promise((rr) => setTimeout(rr, 350));
    const after = blinkValue();
    addLog(`BLINK TEST: giá trị blink sau khi mở lại = ${after.toFixed(3)} (mong đợi 0).`);
    const passed = during > 0.5 && after < 0.1;
    setStatus(
      passed
        ? 'TEST CHỚP MẮT XONG: biểu cảm blink hoạt động (nhắm rồi mở lại).'
        : 'TEST CHỚP MẮT XONG: CÓ VẤN ĐỀ — xem log.',
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif', color: '#111', background: '#fff', minHeight: '100vh' }}>
      <h1>PoC Lip Sync — test harness (không phải giao diện live)</h1>
      <p>
        Model test: Sky (VTubeMe, CC BY 4.0) — chỉ để kiểm tra đường truyền. Audio test: mẫu
        Linh Sensei thật (ElevenLabs, eleven_v4 + vi).
      </p>
      <p>
        <strong>Trạng thái:</strong> {status}
      </p>
      <p>
        <button type="button" onClick={loadModel} disabled={running} style={{ marginRight: 8, padding: '8px 14px' }}>
          1. Tải model
        </button>
        <button type="button" onClick={runTest} disabled={running} style={{ marginRight: 8, padding: '8px 14px' }}>
          2. Chạy test MFCC
        </button>
        <button type="button" onClick={runAttachTest} disabled={running} style={{ marginRight: 8, padding: '8px 14px' }}>
          3. Test nối buffer (đường trang live)
        </button>
        <button type="button" onClick={blinkTest} disabled={running} style={{ marginRight: 8, padding: '8px 14px' }}>
          4. Chớp mắt thử
        </button>
        <button type="button" onClick={() => { setArmDown((v) => !v); addLog(armDown ? 'TAY: dang ra như tư thế gốc (góc 0).' : 'TAY: hạ xuống (trái -1.25 / phải +1.25).'); }} style={{ padding: '8px 14px' }}>
          {armDown ? '5. Để tay dang ra' : '5. Hạ tay xuống'}
        </button> <span style={{ fontSize: 12 }}>(dấu xoay hiện tại: trái -1.25, phải +1.25)</span>
      </p>
      <p>
        Nhân vật chớp mắt tự động mỗi 2–5 giây (giống trang live). Nút 4 ra lệnh chớp mắt 1 lần và ghi giá trị biểu cảm{' '}
        <code>blink</code> vào log để đo, không cần nhìn bằng mắt.
      </p>
      <div style={{ width: 480, height: 480, border: '1px solid #999' }}>
        <Canvas camera={{ position: [0, 1.0, 4.2], fov: 36 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[1.5, 2.5, 2]} intensity={1.6} />
          <color attach="background" args={['#1f2430']} />
          <VrmScene vrmRef={vrmRef} driverRef={driverRef} blinkSignalRef={blinkSignalRef} armDown={armDown} />
        </Canvas>
      </div>
      <h2>Log đo đạc</h2>
      <pre data-testid="poc-log" style={{ whiteSpace: 'pre-wrap', background: '#f3f4f6', padding: 12 }}>
        {log.length ? log.join('\n') : '(chưa có log)'}
      </pre>
    </div>
  );
}
