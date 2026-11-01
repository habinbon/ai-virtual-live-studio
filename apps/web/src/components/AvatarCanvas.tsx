import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import type { AvatarAnimState } from '../audio/animState';
import { tryCreateVrmLipSync, registerVrmLipSyncDriver } from '../lipsync/vrmAdapter';
import type { VrmLipSyncDriver } from '../lipsync/vrmAdapter';

export type BackgroundPreset = 'podcast' | 'bedroom' | 'music' | 'cafe' | 'chat';
export const BACKGROUNDS: Record<BackgroundPreset, { label: string; wall: string; accent: string }> = {
  podcast: { label: 'Phòng podcast', wall: '#1f2430', accent: '#f59e0b' },
  bedroom: { label: 'Phòng ngủ streamer', wall: '#2b1f2e', accent: '#ec4899' },
  music: { label: 'Studio âm nhạc', wall: '#172033', accent: '#22d3ee' },
  cafe: { label: 'Quán cà phê', wall: '#2e2118', accent: '#a78bfa' },
  chat: { label: 'Phòng trò chuyện', wall: '#14261f', accent: '#34d399' },
};
export type VrmStatus = 'checking' | 'vrm' | 'fallback' | 'vrm-error';

const VRM_URL = '/models/character.vrm';

/** Smooth pseudo-random idle driver shared by both avatar types. */
function useIdleClock() {
  const t = useRef(0);
  const blink = useRef({ next: 2.5, closing: 0 });
  const look = useRef({ next: 4, yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 });
  const smile = useRef({ next: 6, value: 0.2, target: 0.2 });
  return { t, blink, look, smile };
}

function updateIdle(
  idle: ReturnType<typeof useIdleClock>,
  delta: number,
  anim: AvatarAnimState,
  apply: (o: { blink01: number; yaw: number; pitch: number; smile: number; breath: number }) => void,
) {
  idle.t.current += delta;
  const time = idle.t.current;
  // Blink: random every 2.2–5.5s, ~120ms close.
  if (time > idle.blink.current.next) {
    idle.blink.current.closing = 0.12;
    idle.blink.current.next = time + 2.2 + Math.random() * 3.3;
  }
  let blink01 = 1;
  if (idle.blink.current.closing > 0) {
    idle.blink.current.closing -= delta;
    blink01 = 0.08;
  }
  // Gaze: slow drift, occasionally glance down at comments.
  if (time > idle.look.current.next) {
    idle.look.current.targetYaw = (Math.random() - 0.5) * 0.35;
    idle.look.current.targetPitch = anim.lookDown ? 0.28 : (Math.random() - 0.5) * 0.14;
    idle.look.current.next = time + 2.5 + Math.random() * 3.5;
  }
  const k = 1 - Math.exp(-delta * 3);
  idle.look.current.yaw += (idle.look.current.targetYaw - idle.look.current.yaw) * k;
  idle.look.current.pitch += (idle.look.current.targetPitch - idle.look.current.pitch) * k;
  // Smile: occasional warm smile.
  if (time > idle.smile.current.next) {
    idle.smile.current.target = Math.random() < 0.5 ? 0.65 : 0.2;
    idle.smile.current.next = time + 4 + Math.random() * 6;
  }
  idle.smile.current.value += (idle.smile.current.target - idle.smile.current.value) * (1 - Math.exp(-delta * 2));
  const breath = Math.sin(time * 1.4) * 0.012; // gentle breathing
  apply({ blink01, yaw: idle.look.current.yaw, pitch: idle.look.current.pitch, smile: anim.speaking || anim.singing ? 0.45 : idle.smile.current.value, breath });
}

function Room({ preset }: { preset: BackgroundPreset }) {
  const bg = BACKGROUNDS[preset];
  return (
    <group>
      <color attach="background" args={[bg.wall]} />
      {/* back wall + floor */}
      <mesh position={[0, 1.5, -1.2]}><planeGeometry args={[7, 4]} /><meshStandardMaterial color={bg.wall} /></mesh>
      <mesh position={[0, -0.55, 0.6]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[7, 4]} /><meshStandardMaterial color="#14100c" /></mesh>
      {/* desk */}
      <mesh position={[0, 0.32, 0.75]}><boxGeometry args={[1.7, 0.07, 0.6]} /><meshStandardMaterial color="#5b3a22" roughness={0.7} /></mesh>
      <mesh position={[-0.75, 0.0, 0.75]}><boxGeometry args={[0.07, 0.7, 0.5]} /><meshStandardMaterial color="#3d2716" /></mesh>
      <mesh position={[0.75, 0.0, 0.75]}><boxGeometry args={[0.07, 0.7, 0.5]} /><meshStandardMaterial color="#3d2716" /></mesh>
      {/* microphone on desk */}
      <mesh position={[0.45, 0.52, 0.7]}><cylinderGeometry args={[0.035, 0.045, 0.28, 16]} /><meshStandardMaterial color="#111827" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0.45, 0.68, 0.7]}><sphereGeometry args={[0.07, 20, 16]} /><meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.35} /></mesh>
      {/* monitor behind, side */}
      <mesh position={[-0.85, 0.75, -0.55]} rotation={[0, 0.35, 0]}><boxGeometry args={[0.7, 0.45, 0.04]} /><meshStandardMaterial color="#0b1220" emissive={bg.accent} emissiveIntensity={0.35} /></mesh>
      {/* decorative lights */}
      {[-1.2, -0.4, 0.4, 1.2].map((x, i) => (
        <mesh key={i} position={[x, 2.35, -1.1]}>
          <sphereGeometry args={[0.06, 16, 12]} />
          <meshStandardMaterial color={bg.accent} emissive={bg.accent} emissiveIntensity={2.2} />
        </mesh>
      ))}
      <pointLight position={[0, 2.2, 1.6]} intensity={18} color="#fff7e6" />
      <pointLight position={[-1.6, 1.2, 0.6]} intensity={5} color={bg.accent} />
    </group>
  );
}

/** Procedural fallback avatar: simple head/body, mouth mesh scaled by mouthOpen. */
function FallbackAvatar({ anim }: { anim: AvatarAnimState }) {
  const head = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const idle = useIdleClock();
  const mouthSmooth = useRef(0);

  useFrame((_, delta) => {
    updateIdle(idle, delta, anim, ({ blink01, yaw, pitch, smile, breath }) => {
      mouthSmooth.current += (anim.mouthOpen - mouthSmooth.current) * (1 - Math.exp(-delta * 18));
      if (head.current) {
        head.current.rotation.y = yaw + Math.sin(idle.t.current * 0.4) * 0.03;
        head.current.rotation.x = pitch + Math.sin(idle.t.current * 0.7) * 0.015;
        head.current.position.y = 1.42 + breath * 0.4;
      }
      if (body.current) {
        body.current.scale.y = 1 + breath;
        body.current.rotation.z = Math.sin(idle.t.current * 0.5) * 0.012;
      }
      if (mouth.current) {
        const open = Math.max(0, mouthSmooth.current);
        mouth.current.scale.set(1 + smile * 0.35, Math.max(0.12, open * 1.6), 1);
        mouth.current.position.y = -0.09 - open * 0.01;
      }
      for (const eye of [eyeL.current, eyeR.current]) {
        if (eye) eye.scale.set(1, blink01, 1);
      }
      const sway = anim.singing ? Math.sin(idle.t.current * 3.2) * 0.18 * anim.energy : Math.sin(idle.t.current * 0.6) * 0.03;
      if (armL.current) armL.current.rotation.z = 0.25 + sway;
      if (armR.current) armR.current.rotation.z = -0.25 - sway;
    });
  });

  return (
    <group position={[0, -0.15, 0]}>
      <group ref={body} position={[0, 0.55, 0]}>
        <mesh position={[0, 0.28, 0]}><capsuleGeometry args={[0.30, 0.55, 6, 16]} /><meshStandardMaterial color="#7c3aed" roughness={0.8} /></mesh>
        <group ref={armL} position={[-0.34, 0.5, 0]}>
          <mesh position={[0, -0.26, 0]}><capsuleGeometry args={[0.07, 0.42, 4, 12]} /><meshStandardMaterial color="#6d28d9" roughness={0.8} /></mesh>
        </group>
        <group ref={armR} position={[0.34, 0.5, 0]}>
          <mesh position={[0, -0.26, 0]}><capsuleGeometry args={[0.07, 0.42, 4, 12]} /><meshStandardMaterial color="#6d28d9" roughness={0.8} /></mesh>
        </group>
      </group>
      <group ref={head} position={[0, 1.42, 0]}>
        {/* head + hair */}
        <mesh><sphereGeometry args={[0.24, 32, 24]} /><meshStandardMaterial color="#f2c9a0" roughness={0.65} /></mesh>
        <mesh position={[0, 0.07, -0.03]} scale={[1.05, 0.95, 1.02]}><sphereGeometry args={[0.245, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.55]} /><meshStandardMaterial color="#3b2a1e" roughness={0.9} /></mesh>
        {/* eyes */}
        <mesh ref={eyeL} position={[-0.085, 0.03, 0.215]}><sphereGeometry args={[0.028, 16, 12]} /><meshStandardMaterial color="#1f2937" /></mesh>
        <mesh ref={eyeR} position={[0.085, 0.03, 0.215]}><sphereGeometry args={[0.028, 16, 12]} /><meshStandardMaterial color="#1f2937" /></mesh>
        {/* brows */}
        <mesh position={[-0.085, 0.085, 0.22]} rotation={[0, 0, 0.1]}><boxGeometry args={[0.07, 0.012, 0.01]} /><meshStandardMaterial color="#3b2a1e" /></mesh>
        <mesh position={[0.085, 0.085, 0.22]} rotation={[0, 0, -0.1]}><boxGeometry args={[0.07, 0.012, 0.01]} /><meshStandardMaterial color="#3b2a1e" /></mesh>
        {/* nose */}
        <mesh position={[0, -0.03, 0.24]}><coneGeometry args={[0.02, 0.05, 12]} /><meshStandardMaterial color="#e8b48c" /></mesh>
        {/* mouth: scaled by mouthOpen */}
        <mesh ref={mouth} position={[0, -0.10, 0.215]}>
          <sphereGeometry args={[0.05, 20, 12]} />
          <meshStandardMaterial color="#7f1d1d" roughness={0.6} />
        </mesh>
      </group>
      {/* chair back hint */}
      <mesh position={[0, 0.35, -0.32]}><boxGeometry args={[0.72, 0.9, 0.08]} /><meshStandardMaterial color="#111827" roughness={0.9} /></mesh>
    </group>
  );
}

function VrmAvatar({ anim, url, onLipSyncNote, onLoadError }: { anim: AvatarAnimState; url: string; onLipSyncNote: (s: string) => void; onLoadError: () => void }) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idle = useIdleClock();
  const lipSyncRef = useRef<VrmLipSyncDriver | null>(null);
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.loadAsync(url).then((gltf) => {
      if (cancelled) return;
      const loaded = gltf.userData.vrm as VRM | undefined;
      if (!loaded) { setError('File không chứa VRM hợp lệ.'); onLoadErrorRef.current(); return; }
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      // VRM 0.x faces away from a +Z camera unless rotated; rotateVRM0 is a
      // no-op for VRM 1.0, so it is safe for the future VRoid main model.
      VRMUtils.rotateVRM0(loaded);
      setVrm(loaded);
      // Try the MFCC adapter only now that a real VRM exists. Failure is
      // non-fatal: mouth falls back to expression 'aa' from anim.mouthOpen.
      tryCreateVrmLipSync(loaded, new AudioContext()).then((r) => {
        if (cancelled) return;
        if (r.ok) {
          lipSyncRef.current = r.driver;
          registerVrmLipSyncDriver(r.driver);
          onLipSyncNote('three-vrm-lip-sync (MFCC) đã khởi tạo cho model VRM — mỗi câu nói sẽ được cấp audio để phân tích (không phát đúp); khi driver không có audio thì dùng analyser fallback qua biểu cảm \'aa\'. [Tay: trái -1.25 / phải +1.25]');
        } else {
          onLipSyncNote(`three-vrm-lip-sync không dùng được (${r.reason}) — dùng analyser fallback qua biểu cảm 'aa'.`);
        }
      }).catch(() => { /* fallback path below */ });
    }).catch((e) => { if (!cancelled) { setError(String((e as Error)?.message || e)); onLoadErrorRef.current(); } });
    return () => { cancelled = true; lipSyncRef.current?.dispose(); lipSyncRef.current = null; registerVrmLipSyncDriver(null); };
  }, [url, onLipSyncNote]);

  useFrame((_, delta) => {
    if (!vrm) return;
    updateIdle(idle, delta, anim, ({ blink01, yaw, pitch, smile, breath }) => {
      const em = vrm.expressionManager;
      if (em) {
        // Blink expression is 0=open, 1=closed in VRM.
        em.setValue('blink', 1 - blink01);
        em.setValue('happy', smile * 0.7);
        // Mouth: the MFCC driver owns visemes ONLY while it has an active
        // audio source. Otherwise the analyser fallback writes 'aa' from
        // anim.mouthOpen (see AudioManager.updateLipSync).
        if (!lipSyncRef.current || !lipSyncRef.current.currentSource) em.setValue('aa', Math.max(0, anim.mouthOpen));
      }
      const head = vrm.humanoid?.getNormalizedBoneNode('head');
      if (head) { head.rotation.y = yaw; head.rotation.x = pitch; }
      const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
      if (spine) spine.rotation.x = breath * 2;
      // Arm-rest pose: VRM rest pose is a T-pose (arms sideways). Lower the
      // upper arms toward the body (same values as the harness pose test;
      // visual confirmation on Sky still required before treating as final).
      const armSway = Math.sin(idle.t.current * 0.5) * 0.02;
      const lArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
      const rArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
      // Dấu xoay này đúng với Twist (VRM 1.0); ngược dấu với Sky (VRM 0.x).
      // Nếu đổi model khác thì phải kiểm chứng lại bằng ảnh chụp.
      if (lArm) lArm.rotation.z = -1.25 - armSway;
      if (rArm) rArm.rotation.z = 1.25 + armSway;
      lipSyncRef.current?.update();
    });
    vrm.update(delta);
  });

  if (error) return <FallbackAvatar anim={anim} />;
  if (!vrm) return null;
  // DO NOT pass rotation={[0,0,0]}: R3F would write it onto vrm.scene and
  // clobber the rotation.y = PI that VRMUtils.rotateVRM0 set for VRM 0.x
  // models (same bug as the harness showed on 2026-11-01). The scene's own
  // rotation is the source of truth.
  return <primitive object={vrm.scene} position={[0, -0.55, 0]} />;
}

export function AvatarCanvas({
  anim, background, onVrmStatus, lipSyncNote, onLipSyncNote,
}: {
  anim: AvatarAnimState;
  background: BackgroundPreset;
  onVrmStatus: (s: VrmStatus) => void;
  lipSyncNote: string;
  onLipSyncNote: (s: string) => void;
}) {
  const [status, setStatus] = useState<VrmStatus>('checking');
  const [hasVrmFile, setHasVrmFile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Thử HEAD trước; nếu máy chủ không hỗ trợ HEAD thì thử GET theo khoảng
    // (1 byte) rồi hủy body ngay — tránh tải cả file 10 MB chỉ để kiểm tra.
    const probe = async (): Promise<boolean> => {
      try {
        const r = await fetch(VRM_URL, { method: 'HEAD' });
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        // Vite dev SPA fallback returns 200 + text/html for a missing file —
        // content-type must not be HTML, otherwise the GLTF parse would fail.
        if (r.ok && !ct.includes('text/html')) return true;
      } catch { /* thử cách tiếp theo */ }
      try {
        const r = await fetch(VRM_URL, { headers: { Range: 'bytes=0-0' } });
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const ok = (r.ok || r.status === 206) && !ct.includes('text/html');
        try { await r.body?.cancel(); } catch { /* bỏ qua */ }
        return ok;
      } catch { return false; }
    };
    probe().then((ok) => {
      if (cancelled) return;
      setHasVrmFile(ok);
      const next: VrmStatus = ok ? 'vrm' : 'fallback';
      setStatus(next);
      onVrmStatus(next);
    }).catch(() => {
      if (cancelled) return;
      setHasVrmFile(false);
      setStatus('fallback');
      onVrmStatus('fallback');
    });
    return () => { cancelled = true; };
  }, [onVrmStatus]);

  const note = useMemo(() => lipSyncNote, [lipSyncNote]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 1.3, 4.2], fov: 36 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[1.5, 2.5, 2]} intensity={1.6} />
        <directionalLight position={[-1.5, 1.5, 1.5]} intensity={0.5} color="#c7d2fe" />
        <Suspense fallback={null}>
          <Room preset={background} />
          {hasVrmFile
            ? <VrmAvatar anim={anim} url={VRM_URL} onLipSyncNote={onLipSyncNote} onLoadError={() => { setStatus('vrm-error'); onVrmStatus('vrm-error'); }} />
            : <FallbackAvatar anim={anim} />}
          <ContactShadows position={[0, -0.55, 0]} opacity={0.45} scale={4} blur={2.2} far={1.6} />
        </Suspense>
      </Canvas>
      <div className="avatar-badge">
        {status === 'checking' && 'Đang kiểm tra model VRM…'}
        {status === 'fallback' && 'Chưa có model VRM — đang dùng avatar tạm (procedural). Thêm file public/models/character.vrm có license rõ ràng để dùng model thật.'}
        {status === 'vrm' && 'Model VRM đã tải.'}
        {status === 'vrm-error' && 'Lỗi tải model VRM — đang dùng avatar tạm.'}
      </div>
      {note && <div className="avatar-badge avatar-badge-2">{note}</div>}
    </div>
  );
}
