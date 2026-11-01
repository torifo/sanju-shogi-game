type PointerSample = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>;
type PointerStart = PointerSample & Pick<PointerEvent, 'isPrimary' | 'button'>;

/** A click must stay near its start for the entire single-pointer gesture. */
export function createPointerGesture(threshold = 8) {
  const active = new Set<number>();
  let blocked = false;
  let start: { id: number; x: number; y: number; maxDistance: number } | undefined;
  const move = (event: PointerSample): void => {
    if (start?.id !== event.pointerId) return;
    start.maxDistance = Math.max(start.maxDistance, Math.hypot(event.clientX - start.x, event.clientY - start.y));
  };
  return {
    down(event: PointerStart): boolean {
      active.add(event.pointerId);
      if (active.size > 1) { blocked = true; start = undefined; }
      if (blocked || !event.isPrimary || event.button !== 0) return false;
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, maxDistance: 0 };
      return true;
    },
    move,
    up(event: PointerSample): { click: boolean; dy: number } | undefined {
      move(event);
      const result = !blocked && start?.id === event.pointerId
        ? { click: start.maxDistance < threshold, dy: event.clientY - start.y } : undefined;
      if (start?.id === event.pointerId) start = undefined;
      active.delete(event.pointerId);
      if (active.size === 0) blocked = false;
      return result;
    },
    cancel(pointerId: number): void {
      active.delete(pointerId); start = undefined;
      blocked = active.size > 0;
    },
  };
}
