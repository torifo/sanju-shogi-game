import { describe, expect, it } from 'vitest';
import { createPointerGesture } from '../src/render/gesture';

const pointer = (pointerId = 1, clientX = 100, clientY = 100, isPrimary = pointerId === 1, button = 0) =>
  ({ pointerId, clientX, clientY, isPrimary, button });

describe('3D盤のポインター判定', () => {
  it('8px未満の揺れはクリックとして扱う', () => {
    const gesture = createPointerGesture();
    expect(gesture.down(pointer())).toBe(true);
    gesture.move(pointer(1, 104, 104));
    expect(gesture.up(pointer(1, 102, 101))).toEqual({ click: true, dy: 1 });
  });
  it.each([8, 50])('%ipx離れて開始点へ戻ってもクリックにしない', distance => {
    const gesture = createPointerGesture();
    gesture.down(pointer());
    gesture.move(pointer(1, 100 + distance));
    gesture.move(pointer());
    expect(gesture.up(pointer())).toEqual({ click: false, dy: 0 });
  });
  it('pointermoveが届かなくても離した位置で閾値を判定する', () => {
    const gesture = createPointerGesture();
    gesture.down(pointer());
    expect(gesture.up(pointer(1, 100, 60))).toEqual({ click: false, dy: -40 });
  });
  it.each([[1, 2], [2, 1]])('2本指を%s→%sの順で離しても選択・層ドラッグにしない', (first, second) => {
    const gesture = createPointerGesture();
    gesture.down(pointer());
    expect(gesture.down(pointer(2))).toBe(false);
    gesture.move(pointer(1, 100, 40));
    expect(gesture.up(pointer(first, 100, 40))).toBeUndefined();
    expect(gesture.up(pointer(second))).toBeUndefined();
    expect(gesture.down(pointer())).toBe(true);
    expect(gesture.up(pointer())?.click).toBe(true);
  });
  it('2本目が離れた後も全ポインターが離れるまでは無効', () => {
    const gesture = createPointerGesture();
    gesture.down(pointer()); gesture.down(pointer(2)); gesture.up(pointer(2));
    expect(gesture.down(pointer(3))).toBe(false);
    expect(gesture.up(pointer())).toBeUndefined();
    expect(gesture.up(pointer(3))).toBeUndefined();
    expect(gesture.down(pointer())).toBe(true);
    expect(gesture.up(pointer())?.click).toBe(true);
  });
  it('キャンセル後はクリックせず、残りの指が離れてから再開する', () => {
    const gesture = createPointerGesture();
    gesture.down(pointer()); gesture.down(pointer(2)); gesture.cancel(2);
    expect(gesture.up(pointer())).toBeUndefined();
    gesture.down(pointer()); gesture.cancel(1);
    expect(gesture.up(pointer())).toBeUndefined();
    gesture.down(pointer());
    expect(gesture.up(pointer())?.click).toBe(true);
  });
  it.each([pointer(1, 100, 100, true, 2), pointer(2)])('右ボタンや非primaryだけでは開始しない: %o', event => {
    const gesture = createPointerGesture();
    expect(gesture.down(event)).toBe(false);
    expect(gesture.up(event)).toBeUndefined();
  });
});
