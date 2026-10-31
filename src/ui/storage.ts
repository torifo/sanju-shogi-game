import type { Game } from '../core/game';
import { loadGame, saveGame } from '../core/serialize';
export const STORAGE_KEY = 'sanju-shogi:v1';
export function clearSavedGame(): boolean {
  try { localStorage.removeItem(STORAGE_KEY); return true; } catch { return false; }
}
export function readSavedGame(): { game: Game | null; message: string } {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return { game: null, message: '' };
    try { return { game: loadGame(JSON.parse(data)), message: '' }; }
    catch { clearSavedGame(); return { game: null, message: '保存データを読み込めなかったため破棄しました。新しく対局できます。' }; }
  } catch { return { game: null, message: 'この環境では保存できません。このまま対局できます。' }; }
}
export function persistGame(game: Game): boolean {
  if (game.phase.kind === 'placing') return true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saveGame(game))); return true; } catch { return false; }
}
