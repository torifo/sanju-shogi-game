import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitBoardCamera } from '../src/render/camera';

describe.each([3, 9])('%i層のカメラ', layers => {
  it.each([2.2, 3.5])('間隔%sで全視点・縦横比に合わせて盤と目盛りを収める', gap => {
    const height = (layers - 1) * gap;
    for (const [width, viewportHeight] of [[838, 538], [349, 358], [1200, 300], [300, 900]]) {
      for (const direction of [new Vector3(12, 13, 16), new Vector3(0, 1, .001), new Vector3(1, .04, 0)]) {
        const camera = new PerspectiveCamera(42, width! / viewportHeight!, .1, 250);
        const { distance } = fitBoardCamera(camera, height, direction);
        expect(distance).toBeGreaterThan(0);
        let extent = 0;
        const xs: number[] = [], ys: number[] = [];
        for (const x of [-5.15, 4.55]) for (const y of [-.16, height + .32]) for (const z of [-5.15, 4.55]) {
          const projected = new Vector3(x, y, z).project(camera);
          extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y));
          xs.push(projected.x); ys.push(projected.y);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(.860001);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(.860001);
          expect(projected.z).toBeGreaterThan(-1);
          expect(projected.z).toBeLessThan(1);
        }
        // 小さく収まりすぎず、少なくとも一方向で外接箱が画面の86%を使う。
        expect(extent).toBeCloseTo(.86, 5);
        // 制約となる方向では両端とも7%の余白になる。
        const limiting = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys) ? xs : ys;
        expect(Math.min(...limiting)).toBeCloseTo(-.86, 5);
        expect(Math.max(...limiting)).toBeCloseTo(.86, 5);
      }
    }
  });
});
