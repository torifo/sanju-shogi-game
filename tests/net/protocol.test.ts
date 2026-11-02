import { describe, expect, it, vi } from 'vitest';
import { commitHash, mergeSync, parseMessage, randomSalt, type NetMessage, type SyncState } from '../../src/net/protocol';
import { buildInviteUrl, createRoomKey, readRoomKey, roomNameFor } from '../../src/net/roomKey';

const publicProofs = { sente: { salt: 'AAAAAAAAAAAAAAAAAAAAAA', hash: '8bf74bdd58e9012f58c94137573112160a64ec370cef13712f2b1fa3d8877a83' },
  gote: { salt: 'AAAAAAAAAAAAAAAAAAAAAA', hash: '8bf74bdd58e9012f58c94137573112160a64ec370cef13712f2b1fa3d8877a83' } };
const assignment = Array<number>(20).fill(1);
const salt = 'AAAAAAAAAAAAAAAAAAAAAA';
const sync: SyncState = { layers: 3, reveals: publicProofs, undo: null, placements: { sente: assignment, gote: assignment }, moves: [] };
const move = 'm:7,7,1>7,6,1';
const messages: NetMessage[] = [
  { type: 'hello', protocol: 2, role: 'host', layers: 3 },
  { type: 'hello', protocol: 2, role: 'guest', layers: 9, resume: { layers: 9, reveals: null, undo: null, placements: null, moves: [] } },
  { type: 'assign', hostColor: 'gote' }, { type: 'commit', hash: 'a'.repeat(64) },
  { type: 'reveal', assignment, salt }, { type: 'move', epoch: 0, ply: 1, move },
  { type: 'undo-request', epoch: 1, id: salt, requester: 'host', ply: 1 }, { type: 'undo-reply', epoch: 1, id: 'AAAAAAAAAAAAAAAAAAAAAA', requester: 'host', ply: 2, accepted: false },
  { type: 'resign', epoch: 0, ply: 0, color: 'sente' }, { type: 'sync', state: sync },
  { type: 'full' }, { type: 'error', reason: '記録が不一致' },
];

describe('メッセージの境界検証', () => {
  it.each(messages)('$typeを受理する', message => expect(parseMessage(message)).toEqual(message));
  it.each(messages)('$typeの余分なキーを拒否する', message => expect(parseMessage({ ...message, extra: 1 })).toBeNull());
  it.each(messages.filter(m => m.type !== 'full'))('$typeの必須キー欠落を拒否する', message => {
    for (const key of Object.keys(message).filter(k => k !== 'type' && k !== 'resume')) {
      const raw = { ...message } as Record<string, unknown>;
      delete raw[key];
      expect(parseMessage(raw)).toBeNull();
    }
  });
  it.each([null, [], 1, 'hello', {}, { type: 'unknown' },
    { type: 'hello', protocol: '1', role: 'host', layers: 3 },
    { type: 'hello', protocol: 2, role: 'other', layers: 3 },
    { type: 'hello', protocol: 2, role: 'host', layers: 4 },
    { type: 'assign', hostColor: 'other' }, { type: 'commit', hash: 'z'.repeat(64) },
    { type: 'commit', hash: 'a'.repeat(63) }, { type: 'commit', hash: 'a'.repeat(64) + '\n' },
    ...[[], Array(19).fill(1), Array(20), Array(20).fill(0.5), Array(20).fill(-1), Array(20).fill(9), Array(20).fill('1')]
      .map(assignment => ({ type: 'reveal', assignment, salt })),
    { type: 'reveal', assignment, salt: '' }, { type: 'move', epoch: 0, ply: 1, move: 'bad' },
    ...[-1, 0, 1.5, Infinity, '1'].map(ply => ({ type: 'move', ply, move })),
    { type: 'undo-reply', epoch: 1, id: 'AAAAAAAAAAAAAAAAAAAAAA', requester: 'host', ply: 1, accepted: 'yes' }, { type: 'resign', epoch: 0, ply: 0, color: 'other' },
    { type: 'sync', state: { ...sync, extra: true } },
    { type: 'sync', state: { ...sync, placements: null, moves: [move] } },
    { type: 'sync', state: { ...sync, result: { kind: 'draw', reason: 'bad' } } },
    { type: 'sync', state: { ...sync, placements: { sente: assignment, gote: Array(20).fill(3) } } },
  ])('不正な入力 %j を捨てる', raw => expect(parseMessage(raw)).toBeNull());
  it('R5: 巨大な棋譜は要素を走査・複製する前に拒否する', () => {
    const moves = Array<string>(100_000);
    const access = vi.fn(() => { throw Error('must not read'); });
    Object.defineProperty(moves, 0, { get: access });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    expect(parseMessage({ type: 'sync', state: { ...sync, moves } })).toBeNull();
    expect(parseMessage({ type: 'hello', protocol: 2, role: 'host', layers: 3, resume: { ...sync, moves } })).toBeNull();
    expect(access).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled(); clone.mockRestore();
  });
  it('R5: 棋譜2000手・reason256文字の境界と各文字列・配列の上限', () => {
    expect(parseMessage({ type: 'sync', state: { ...sync, moves: Array(2000).fill(move) } })).not.toBeNull();
    expect(parseMessage({ type: 'sync', state: { ...sync, moves: Array(2001).fill(move) } })).toBeNull();
    expect(parseMessage({ type: 'error', reason: 'あ'.repeat(256) })).not.toBeNull();
    for (const size of [257, 1_000_000]) expect(parseMessage({ type: 'error', reason: 'x'.repeat(size) })).toBeNull();
    for (const raw of [
      { type: 'commit', hash: 'a'.repeat(1_000_000) },
      { type: 'reveal', assignment, salt: 'x'.repeat(1_000_000) },
      { type: 'reveal', assignment: Array(100_000).fill(1), salt },
      { type: 'move', epoch: 0, ply: 1, move: 'x'.repeat(1_000_000) },
      { type: 'sync', state: { ...sync, reveals: { ...publicProofs, sente: { ...publicProofs.sente, salt: 'x'.repeat(1000) } } } },
    ]) expect(parseMessage(raw)).toBeNull();
  });
  it('バージョン違いをセッションに通知できるよう整数のprotocolを保持する', () => {
    expect(parseMessage({ type: 'hello', protocol: 2, role: 'host', layers: 3 })?.type).toBe('hello');
  });
});

describe('コミットと招待リンク', () => {
  it('JSONのSHA-256を求め、saltで変わる', async () => {
    const hash = await commitHash(assignment, salt);
    const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ assignment, salt })));
    expect(hash).toBe(Array.from(new Uint8Array(expected), b => b.toString(16).padStart(2, '0')).join(''));
    expect(await commitHash(assignment, salt)).toBe(hash);
    expect(await commitHash(assignment, 'BBBBBBBBBBBBBBBBBBBBBB')).not.toBe(hash);
  });
  it('128bitのキーとsaltを作り、URLを往復する', () => {
    const key = createRoomKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomSalt()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(createRoomKey()).not.toBe(key);
    const url = buildInviteUrl('https://example.com/game/?a=1#old', key);
    expect(url).toBe(`https://example.com/game/?a=1#room=${key}`);
    expect(readRoomKey(new URL(url).hash)).toBe(key);
  });
  it.each(['', '#room=', '#room=short', '#room=' + 'a'.repeat(23), '#room=' + '+'.repeat(22),
    '#room=' + 'a'.repeat(22) + '&x=1', '#other=' + 'a'.repeat(22)])('不正なhash %sを拒否する', hash => {
    expect(readRoomKey(hash)).toBeNull();
  });
  it('部屋名はSHA-256の先頭16文字', async () => {
    expect(await roomNameFor('AAAAAAAAAAAAAAAAAAAAAA')).toBe('8a5bdb4cc1516412');
    expect(() => buildInviteUrl('https://example.com', 'bad')).toThrow();
  });
});

describe('SyncStateの突き合わせ', () => {
  it('same / adopt-remote / keep-local / conflictを返す', () => {
    const longer = { ...sync, moves: [move] };
    expect(mergeSync(sync, structuredClone(sync))).toEqual({ kind: 'same' });
    expect(mergeSync(sync, longer)).toEqual({ kind: 'adopt-remote' });
    expect(mergeSync(longer, sync)).toEqual({ kind: 'keep-local' });
    expect(mergeSync(longer, { ...sync, moves: ['m:6,7,1>6,6,1'] })).toEqual({ kind: 'conflict' });
  });
  it('層・配置・不正な棋譜・不正な結果を拒否する', () => {
    for (const remote of [{ ...sync, layers: 9 },
      { ...sync, placements: { sente: Array(20).fill(0), gote: assignment } },
      { ...sync, moves: ['m:7,7,1>7,4,1'] },
      { ...sync, result: { kind: 'draw', reason: 'repetition' } as const }]) {
      expect(mergeSync(sync, remote)).toEqual({ kind: 'conflict' });
    }
  });
  it('投了を採用し、行き違った延長より投了を優先して矛盾する結果は拒否する', () => {
    const ended: SyncState = { ...sync, result: { kind: 'win', winner: 'gote', reason: 'resign' } };
    expect(mergeSync(sync, ended)).toEqual({ kind: 'adopt-remote' });
    expect(mergeSync(ended, sync)).toEqual({ kind: 'keep-local' });
    expect(mergeSync(ended, { ...sync, moves: [move] })).toEqual({ kind: 'keep-local' });
    expect(mergeSync(ended, { ...sync, result: { kind: 'win', winner: 'sente', reason: 'resign' } })).toEqual({ kind: 'conflict' });
  });
});
