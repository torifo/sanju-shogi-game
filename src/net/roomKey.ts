import { isToken, randomSalt, sha256 } from './protocol';

export const createRoomKey = randomSalt;
export function buildInviteUrl(baseUrl: string, key: string): string {
  if (!isToken(key)) throw new Error('部屋のキーが不正です');
  const url = new URL(baseUrl);
  url.hash = `room=${key}`;
  return url.toString();
}
export function readRoomKey(hash: string): string | null {
  const key = hash.startsWith('#room=') ? hash.slice(6) : '';
  return isToken(key) ? key : null;
}
export function roomNameFor(key: string): Promise<string> {
  if (!isToken(key)) return Promise.reject(new Error('部屋のキーが不正です'));
  return sha256(key).then(hash => hash.slice(0, 16));
}
