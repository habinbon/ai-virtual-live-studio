import { useEffect, useRef } from 'react';
import type { AvatarAnimState } from '../audio/animState';

/**
 * 2D photo avatar: the cô Quyên portrait (1120x2240) with a blinking
 * eyelid overlay + a talking-mouth overlay.
 *
 * Positions are % of the portrait, MEASURED by visual grounding on
 * 2026-11-07 (do not re-estimate by eye): mouth centre x 50.5%, y 50.1%;
 * left eye centre x 59.7%, y 40.8%; right eye centre x 39.7%, y 42.1%;
 * nose tip x 50.2%, y 47.2%. First version had the mouth at 46.5% — that
 * is the NOSE, user reported "mồm mấp máy lại ở mũi ảnh"; fixed to 50.1%.
 *
 * Mouth level comes from anim.mouthOpen, updated every frame by
 * useLiveSession's rAF loop (AudioManager.updateLipSync) — this component
 * only reads it and writes styles straight to refs, so there is no React
 * re-render at 60 fps. Blink runs on its own timer (same timing as the
 * 3D avatar: every 2.2–5.5 s, ~120 ms closed).
 *
 * Honest limits: a photo cannot turn its head, glance at comments, or move
 * its arms — it blinks, breathes (gentle sway), and opens its mouth with
 * the voice. The office background is baked into the portrait itself.
 */
const PORTRAIT_URL = '/avatars/co-quyen-2d.webp';

export function Avatar2D({ anim }: { anim: AvatarAnimState }) {
  const lidL = useRef<HTMLDivElement>(null);
  const lidR = useRef<HTMLDivElement>(null);
  const mouth = useRef<HTMLDivElement>(null);
  const mouthSmooth = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let nextBlink = last + 2500;
    let closingUntil = 0;
    const loop = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Blink: random every 2.2–5.5 s, ~120 ms closed.
      if (now > nextBlink) {
        closingUntil = now + 120;
        nextBlink = now + 2200 + Math.random() * 3300;
      }
      const s = now < closingUntil ? 1 : 0;
      for (const lid of [lidL.current, lidR.current]) {
        if (lid) lid.style.transform = `scaleY(${s})`;
      }
      // Mouth: smooth the analyser level, like the 3D fallback avatar.
      mouthSmooth.current += (anim.mouthOpen - mouthSmooth.current) * (1 - Math.exp(-delta * 18));
      const open = Math.max(0, mouthSmooth.current);
      const el = mouth.current;
      if (el) {
        el.style.opacity = open > 0.03 ? '1' : '0';
        el.style.height = `${(open * 2.0).toFixed(2)}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anim]);

  return (
    <div className="avatar2d">
      <div className="avatar2d-frame">
        <img className="avatar2d-img" src={PORTRAIT_URL} alt="Cô Quyên — nhân vật AI" draggable={false} />
        <div ref={lidL} className="avatar2d-lid" style={{ left: '37.3%', top: '40.0%' }} />
        <div ref={lidR} className="avatar2d-lid" style={{ left: '56.4%', top: '40.0%' }} />
        <div ref={mouth} className="avatar2d-mouth" />
      </div>
      <div className="avatar-badge">Ảnh 2D — cô Quyên (chớp mắt + mấp máy môi theo giọng nói).</div>
    </div>
  );
}
