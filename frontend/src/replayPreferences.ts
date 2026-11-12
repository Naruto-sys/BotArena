import type { CameraMode } from './BlueprintArena';

const key = 'botarena.replay.camera';
const cameras = new Set(['auto', 'adaptive', 'plan', 'overview', 'perception', 'timeline']);

export function loadCameraMode(botIds: string[]): CameraMode {
  try {
    const saved = localStorage.getItem(key);
    if (saved && (cameras.has(saved) || (saved.startsWith('bot:') && botIds.includes(saved.slice(4))))) return saved as CameraMode;
  } catch { /* Viewer still works when browser storage is unavailable. */ }
  return 'plan';
}

export function saveCameraMode(camera: CameraMode) {
  try { localStorage.setItem(key, camera); } catch { /* Preference is optional. */ }
}
