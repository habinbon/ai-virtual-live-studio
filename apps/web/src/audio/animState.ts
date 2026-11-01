/** Shared mutable avatar animation inputs, updated by audio/state, read by useFrame. */
export interface AvatarAnimState {
  mouthOpen: number;
  speaking: boolean;
  singing: boolean;
  smile: number; // 0..1
  lookDown: boolean; // occasionally glance at comments
  energy: number; // 0..1, higher while singing
}

export function createAnimState(): AvatarAnimState {
  return { mouthOpen: 0, speaking: false, singing: false, smile: 0.2, lookDown: false, energy: 0.3 };
}
