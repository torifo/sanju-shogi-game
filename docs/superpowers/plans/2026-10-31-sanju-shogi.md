# 三重将棋 実装計画

> **実装者へ:** 各タスクは独立して実行できる単位。テストを先に書き（TDD）、`npm test` と `npm run typecheck` が通る状態で終える。**git commit はしない**（レビュー後にまとめてコミットする）。
> 仕様は `docs/superpowers/specs/2026-10-31-sanju-shogi-design.md`。食い違いがあれば仕様を優先し、報告すること。

**Goal:** 9×9×3 層の立体将棋（ローカル 2 人対戦・秘密配置）を GitHub Pages で遊べる静的サイトとして作る。

**Architecture:** `src/core` は DOM と Three.js に依存しない純粋な TypeScript のルールエンジン。`src/render`（Three.js）と `src/ui`（DOM）は `core/game.ts` の通知を受けて描くだけで、局面を直接書き換えない。盤の層の数は `BoardConfig.layers` で持ち、3 と 9 の両方でテストする。

**Tech Stack:** Vite, TypeScript (strict), Three.js（OrbitControls）, Vitest。UI フレームワークは使わない。

**分担:** 実装・テスト = Codex `gpt-6.1-sol`。レビュー = Codex `gpt-6-astra`（コアの完成時と全体の完成時の 2 回）。

---

## ファイル構成

```
index.html
package.json  tsconfig.json  vite.config.ts  vitest.config.ts（vite.config に含めてもよい）
.gitignore
.github/workflows/ci.yml      push / PR で typecheck + test + build
.github/workflows/deploy.yml  main への push で Pages にデプロイ
README.md
src/
  main.ts
  style.css
  core/
    types.ts  config.ts  pieces.ts  position.ts  setup.ts
    movegen.ts  rules.ts  hash.ts  notation.ts  serialize.ts  game.ts
  render/
    scene.ts  boardMesh.ts  pieceMesh.ts  highlights.ts  picking.ts  camera.ts
  ui/
    app.ts  handoff.ts  placement.ts  hands.ts  promotion.ts  log.ts  minimap.ts  banner.ts  storage.ts
tests/
  helpers.ts  pieces.test.ts  position.test.ts  movegen.test.ts  rules.test.ts
  game.test.ts  notation.test.ts  serialize.test.ts
```

## 共通の型（Task 2 で定義し、以降はこれに従う）

```ts
// src/core/types.ts
export type Color = 'sente' | 'gote';
export type HandKind = 'R' | 'B' | 'G' | 'S' | 'N' | 'L' | 'P';
export type BaseKind = 'K' | HandKind;
export type PromotedKind = '+R' | '+B' | '+S' | '+N' | '+L' | '+P';
export type PieceType = BaseKind | PromotedKind;

export interface Piece { type: PieceType; color: Color }
/** x: 筋 1..9, y: 段 1..9（先手から見て奥が 1）, z: 層 0..layers-1（0 = 下層） */
export interface Square { x: number; y: number; z: number }

export type Move =
  | { kind: 'move'; from: Square; to: Square; promote: boolean }
  | { kind: 'drop'; piece: HandKind; to: Square };

export const opposite = (c: Color): Color => (c === 'sente' ? 'gote' : 'sente');
```

```ts
// src/core/config.ts
export interface BoardConfig { files: 9; ranks: 9; layers: number }
export const SANJU: BoardConfig = { files: 9, ranks: 9, layers: 3 };
export const CUBE: BoardConfig = { files: 9, ranks: 9, layers: 9 }; // 次の拡張用。UI からはまだ選べない
```

---

### Task 1: 足場（Vite + TS + Vitest + Three.js + Pages）

**Files:** `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/style.css`, `.gitignore`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `README.md`

- [ ] `package.json`（name: `sanju-shogi`, private, type: module）。scripts: `dev`=`vite`, `build`=`tsc --noEmit && vite build`, `preview`=`vite preview`, `test`=`vitest run`, `typecheck`=`tsc --noEmit`。依存: `three`、devDeps: `vite`, `typescript`, `vitest`, `@types/three`。バージョンは `npm install` で入る最新安定版。
- [ ] `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `target/module: ES2022`, `moduleResolution: bundler`, `include: ["src", "tests"]`。
- [ ] `vite.config.ts`: `base: process.env.BASE_PATH ? process.env.BASE_PATH.replace(/\/?$/, '/') : '/'`。`test: { environment: 'node', include: ['tests/**/*.test.ts'] }`。
- [ ] `.gitignore`: `node_modules`, `dist`, `.DS_Store`, `*.local`。
- [ ] `deploy.yml`: 下の内容で作る（`fade-ticae` と同じ形。出力は `dist`）。

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - name: Build
        run: npm run build
        env:
          BASE_PATH: /sanju-shogi-game/
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] `ci.yml`: `pull_request` と `main` 以外への push で `npm ci && npm run typecheck && npm test && npm run build`。
- [ ] `index.html`: `<html lang="ja">`、`<div id="app"></div>`、`src/main.ts` を読む。タイトル「三重将棋」。
- [ ] `README.md`: 作品の一文説明、遊び方（3 行）、開発コマンド。
- [ ] 確認: `npm run build` が通る。

### Task 2: 型・設定・駒の定義

**Files:** `src/core/types.ts`, `src/core/config.ts`, `src/core/pieces.ts`, `tests/pieces.test.ts`

`pieces.ts` に駒ごとの「先手から見た」動きを定義する。前 = dy が -1。後手は dy を反転（dx も反転してよい。左右対称なので結果は同じだが、桂の判定のため dy の反転は必須）。

```ts
export interface PieceSpec {
  steps: ReadonlyArray<readonly [dx: number, dy: number]>;   // 一歩ずつ（dz は -1/0/+1 を組み合わせる）
  jumps: ReadonlyArray<readonly [dx: number, dy: number]>;   // 桂のみ。飛び越える
  slides: ReadonlyArray<readonly [dx: number, dy: number]>;  // 走る方向
  vertical: 'none' | 'step' | 'slide';                      // 真上・真下 (0,0,±1)
}
export const PIECE_SPECS: Record<PieceType, PieceSpec>;
export function promote(t: PieceType): PieceType;   // 成れない駒はそのまま返す
export function unpromote(t: PieceType): BaseKind;
export function canPromoteType(t: PieceType): boolean; // R B S N L P のみ true
export function directionFor(color: Color, v: readonly [number, number]): [number, number];
```

定義（先手視点）:

| 駒 | steps | jumps | slides | vertical |
|---|---|---|---|---|
| K | 周囲 8 | - | - | step |
| G, +S, +N, +L, +P | (0,-1)(±1,-1)(±1,0)(0,1) | - | - | step |
| S | (0,-1)(±1,-1)(±1,1) | - | - | none |
| N | - | (±1,-2) | - | none |
| L | - | - | (0,-1) | none |
| P | (0,-1) | - | - | none |
| R | - | - | (0,±1)(±1,0) | slide |
| B | - | - | (±1,±1) | none |
| +R | (±1,±1) | - | (0,±1)(±1,0) | slide |
| +B | (0,±1)(±1,0) | - | (±1,±1) | step |

- [ ] テスト（`tests/pieces.test.ts`）:
  - `PIECE_SPECS.K.steps.length === 8`, `PIECE_SPECS.K.vertical === 'step'`
  - 金・成駒 4 種の steps が同じ集合で、vertical が `step`
  - `S`, `N`, `L`, `P`, `B` の vertical が `none`、`R`, `+R` が `slide`、`+B` が `step`
  - `promote('P') === '+P'`, `promote('G') === 'G'`, `promote('K') === 'K'`, `unpromote('+R') === 'R'`
  - `directionFor('gote', [1, -2])` の dy が `2`
- [ ] 実装してテストを通す。

### Task 3: 局面と初期配置

**Files:** `src/core/position.ts`, `src/core/setup.ts`, `tests/helpers.ts`, `tests/position.test.ts`

```ts
// position.ts
export type Hands = Record<Color, Record<HandKind, number>>;
export interface Undo { move: Move; captured: Piece | null; movedBefore: Piece | null }
export class Position {
  constructor(config: BoardConfig);
  readonly config: BoardConfig;
  cells: (Piece | null)[];       // 長さ 81 * layers
  hands: Hands;
  sideToMove: Color;
  static index(sq: Square): number;   // (x-1) + (y-1)*9 + z*81
  inBounds(sq: Square): boolean;
  get(sq: Square): Piece | null;
  set(sq: Square, p: Piece | null): void;
  clone(): Position;
  apply(move: Move): Undo;   // 合法性は確かめない。取った駒は unpromote して手番側の持ち駒へ。手番を交代
  undo(u: Undo): void;
  findKing(color: Color): Square | null;
}
```

```ts
// setup.ts
export interface LayoutEntry { kind: BaseKind; x: number; y: number }
/** 先手の本将棋初期位置 20 枚。この並び順が層の割り当て配列の添字になる */
export const STANDARD_LAYOUT: readonly LayoutEntry[];
// 並び順: 歩 9..1 筋（y=7）, 角(8,8), 飛(2,8), 香(9,9), 桂(8,9), 銀(7,9), 金(6,9), 玉(5,9), 金(4,9), 銀(3,9), 桂(2,9), 香(1,9)
export type LayerAssignment = readonly number[]; // 長さ 20、各要素 0..layers-1
export function defaultAssignment(config: BoardConfig): number[];  // 全部中層 = Math.floor(layers/2)
export function randomAssignment(config: BoardConfig, rng?: () => number): number[];
export function validateAssignment(config: BoardConfig, a: LayerAssignment): boolean;
/** 後手は先手の位置を (10-x, 10-y) に写す。後手の割り当ても同じ並び順で後手自身の駒を指す */
export function createInitialPosition(config: BoardConfig, sente: LayerAssignment, gote: LayerAssignment): Position;
```

`tests/helpers.ts`: テスト用に空の局面へ駒を置く関数を用意する。

```ts
export function emptyPosition(layers = 3, side: Color = 'sente'): Position;
export function put(pos: Position, x: number, y: number, z: number, type: PieceType, color: Color): void;
export const sq = (x: number, y: number, z: number): Square => ({ x, y, z });
```

- [ ] テスト:
  - `Position.index(sq(1,1,0)) === 0`, `Position.index(sq(9,9,2)) === 242`
  - 3 層で `inBounds(sq(5,5,3)) === false`、9 層で `true`
  - `createInitialPosition(SANJU, defaultAssignment(SANJU), defaultAssignment(SANJU))`: 40 枚、全部 z=1、先手の玉が (5,9,1)、後手の玉が (5,1,1)、後手の飛が (8,2,1)
  - 先手の割り当てで飛（添字 10）を 2 にすると (2,8,2) に先手の飛
  - `validateAssignment` は長さ違い・範囲外・非整数で false
  - `apply` → `undo` で cells・hands・sideToMove が元どおり（取りを含む手、成りを含む手、打ち）
  - 成駒を取ると持ち駒は成る前の種類で増える
- [ ] 実装してテストを通す。

### Task 4: 指し手の生成（立体の動き）

**Files:** `src/core/movegen.ts`, `tests/movegen.test.ts`

```ts
/** 手番側の疑似合法手（自玉の王手放置・打ちの制約・成りの強制は rules.ts で絞る。ただし成りの選択肢はここで両方出す） */
export function generatePseudoMoves(pos: Position): Move[];
/** sq の駒（または空きマス）に by の駒が利いているか */
export function isAttacked(pos: Position, sq: Square, by: Color): boolean;
/** 1 枚の駒の移動先（成りは考えない）。UI の強調表示とテストに使う */
export function destinations(pos: Position, from: Square): Square[];
```

規則（仕様 §3）:
- steps: (x+dx, y+dy, z+dz), dz ∈ {-1,0,1}
- jumps: 同上、途中は無視
- slides: (dx,dy,dz), dz ∈ {-1,0,1} の各組で k=1,2,… と進む。盤外か駒で止まる。敵駒なら取って止まる
- vertical `step`: (0,0,±1)。`slide`: (0,0,±1) 方向に走る
- 自分の駒があるマスへは行けない
- 成りの選択肢: 移動元か移動先が敵陣（先手 y≤3、後手 y≥7）で、`canPromoteType` なら promote: true と false の 2 手。強制のときは rules.ts で false を落とす
- 打ち: 持ち駒の種類ごとに全空きマス（制約は rules.ts）

- [ ] テスト（`emptyPosition` を使う）:
  - 先手の歩 (5,5,1): 移動先は (5,4,0)(5,4,1)(5,4,2) の 3 つだけ
  - 先手の歩 (5,5,0): (5,4,0)(5,4,1) の 2 つ（下に層がない）
  - 先手の玉 (5,5,1): 8×3 + 2 = 26。玉 (5,5,0) は 8×2 + 1 = 17
  - 先手の銀 (5,5,1): 5×3 = 15、真上 (5,5,2) は含まない
  - 先手の金 (5,5,1): 6×3 + 2 = 20、(5,5,2) と (5,5,0) を含む
  - 先手の桂 (5,5,1): (4,3,z)(6,3,z) z=0..2 の 6 つ。(5,4,1) に駒があっても 6 つ
  - 後手の桂 (5,5,1): (4,7,z)(6,7,z)
  - 先手の飛 (5,5,0)、空の盤、3 層: 平面の 4 方向 × dz=0 が 4+4+4+4=16、dz=+1 の 4 方向で各 2 マス = 8、真上 2 → 合計 26
  - 同じ飛を 9 層で: 16 + dz=+1 方向で各 min(端までの距離, 8) …… 期待値は「(4,5,1)(3,5,2)…(1,5,4) が含まれ (5,5,9) は含まれない」で確かめる
  - 走りが止まる: 先手の飛 (5,5,0)、自分の歩 (4,5,1) → (3,5,2) は含まない。敵の歩なら (4,5,1) を含み (3,5,2) は含まない
  - 先手の角 (5,5,1): 真上 (5,5,2) を含まない。(4,4,2) と (6,6,0) を含む
  - 先手の香 (5,5,1): dz=0 で (5,4,1)〜(5,1,1) の 4 マス、dz=-1 で (5,4,0) の 1 マス、dz=+1 で (5,4,2) の 1 マス → 合計 6
  - 竜 (5,5,1): 斜め一歩は層 ±1 込みで 4×3=12 が含まれる。真上へ走る
  - 馬 (5,5,1): 真上 (5,5,2) は含むが (5,5,2) より先には進まない（3 層なのでもともと端だが、9 層で (5,5,3) が含まれないことも確かめる）
  - `isAttacked`: 後手の飛 (5,1,2) と先手の玉 (5,9,2) の間が空いていれば true、間に駒があれば false。後手の飛 (5,1,1) から (5,9,2) へは dz=+1 で 1 マスしか進めないので false
  - 成り: 先手の銀 (5,4,1) → (5,3,1) で promote true/false の 2 手が出る。先手の金は 1 手のみ
- [ ] 実装してテストを通す。

### Task 5: ルール（合法手・打ちの制約・成りの強制・勝敗）

**Files:** `src/core/rules.ts`, `tests/rules.test.ts`

```ts
export function isInCheck(pos: Position, color: Color): boolean;
export function mustPromote(type: PieceType, color: Color, toY: number): boolean; // 歩・香が最奥段、桂が奥 2 段
export function generateLegalMoves(pos: Position): Move[];
export function isLegalMove(pos: Position, move: Move): boolean;
export type Status =
  | { kind: 'ongoing'; check: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'no-moves'; winner: Color };   // 王手でなく指せる手がない（手番側の負け）
export function status(pos: Position): Status;
```

`generateLegalMoves` の絞り込み:
1. 自玉が取られる形になる手を除く（`apply` → `isInCheck` → `undo`）
2. 強制成りなのに promote: false の手を除く
3. 打ち: 歩・香は最奥段、桂は奥 2 段に打てない
4. 二歩: 同じ筋 x・同じ層 z に成っていない自分の歩があるマスへ歩を打てない
5. 打ち歩詰め: 歩を打った結果、相手が詰みになるなら除く（再帰を避けるため、打った後の局面で相手の `generateLegalMoves` が空かどうかを調べる関数は打ち歩詰めの判定を省いた版を使ってよい）

- [ ] テスト:
  - 自玉が後手の飛 (5,1,1) に縦で狙われ、間の先手の金 (5,5,1) を横に動かす手は合法手に含まれない
  - 同じ盤で、後手の飛が (5,1,0) にあり先手の玉が (5,9,1) なら、金は自由に動ける（立体の線上にない）
  - 二歩: 先手の歩が (5,7,1) にあるとき、持ち駒の歩を (5,5,1) に打てない、(5,5,0) と (5,5,2) には打てる。成った歩 (+P) が (5,7,1) なら打てる
  - 行き所: 持ち駒の歩を y=1 に打てない、桂を y=2 に打てない、香を y=1 に打てない
  - 強制成り: 先手の歩 (5,2,1) → (5,1,z) は promote: true の手だけ。先手の桂 (5,4,1) → (4,2,z) も true のみ
  - 打ち歩詰め: 後手の玉 (5,1,1)、先手の金 (5,3,1)（玉の逃げ道を全部塞ぐ配置を用意）、持ち駒の歩 → (5,2,1) への歩打ちは合法手に含まれない。同じ形で歩以外（金）を打つ詰みは含まれる
  - 詰み: `status` が `checkmate`、winner が王手をかけた側
  - 9 層でも、二歩と王手の判定のテストのうち 1 つずつを `emptyPosition(9)` で流す
- [ ] 実装してテストを通す。

> 詰みの局面は 3D だと逃げ道が多い（上下の層にも逃げられる）。テストの局面を作るときは、玉を下層の隅（例: (1,1,0)）に置くと塞ぎやすい。

### Task 6: ハッシュ・棋譜表記・保存形式・対局の進行

**Files:** `src/core/hash.ts`, `src/core/notation.ts`, `src/core/serialize.ts`, `src/core/game.ts`, `tests/game.test.ts`, `tests/notation.test.ts`, `tests/serialize.test.ts`

```ts
// hash.ts — 決定的な疑似乱数（固定シードの xorshift 等）で表を作る。BigInt ではなく 2 つの 32bit 整数を組にした文字列キーでよい
export function hashPosition(pos: Position): string;
```

```ts
// notation.ts
export function layerLabel(z: number, layers: number): string; // 3 層: 下/中/上、それ以外: `${z+1}層`
/** pos は手を指す前の局面。「同」は使わず常に筋段を書く。
 *  例: "▲7六歩 中→上", 成り "▲2三歩成 中→中", 不成 "▲2三銀不成 下→中", 打ち "▲5五角打 上" */
export function formatMove(pos: Position, move: Move): string;
```
筋は算用数字、段は漢数字（一〜九）。駒名: 玉 飛 角 金 銀 桂 香 歩 竜 馬 成銀 成桂 成香 と。後手は △。

```ts
// serialize.ts
export interface SavedGame { v: 1; layers: number; sente: number[]; gote: number[]; moves: string[] }
export function encodeMove(m: Move): string;  // "m:x,y,z>x,y,z" + 成りなら "+"、打ち "d:P>x,y,z"
export function decodeMove(s: string): Move;  // 不正なら throw
export function saveGame(g: Game): SavedGame;
export function loadGame(data: unknown): Game; // 形式が違う・手が非合法なら throw
```

```ts
// game.ts
export type Phase =
  | { kind: 'placing'; color: Color }      // 先手→後手の順
  | { kind: 'playing' }
  | { kind: 'ended'; result: Result };
export type Result =
  | { kind: 'win'; winner: Color; reason: 'checkmate' | 'no-moves' | 'resign' | 'perpetual-check' }
  | { kind: 'draw'; reason: 'repetition' };
export interface GameEvent { type: 'phase' | 'move' | 'undo'; }
export class Game {
  constructor(config: BoardConfig);
  readonly config: BoardConfig;
  phase: Phase;
  position: Position | null;            // 対局開始まで null
  readonly moves: Move[];
  readonly notation: string[];
  submitPlacement(color: Color, a: LayerAssignment): void; // 手番違い・不正な割り当ては throw。後手の確定で局面を作り playing へ
  placement(color: Color): number[] | null;               // 公開後のみ両者の値を返す。配置中は自分の分だけ
  legalMoves(): Move[];
  play(move: Move): void;      // 非合法なら throw し、状態を変えない
  undo(): void;                // 1 手戻す。ended からも戻せる（playing に戻る）
  resign(color: Color): void;
  subscribe(fn: (e: GameEvent) => void): () => void;
}
```

千日手: 各手の後の局面ハッシュと「その手で王手をかけたか」を記録。同じハッシュが 4 回目に現れたら、1 回目から今回までの間の、一方の側の手がすべて王手ならその側の負け（`perpetual-check`）、そうでなければ引き分け。

- [ ] テスト:
  - `submitPlacement('gote', …)` を先に呼ぶと throw。先手→後手の順で playing、手番は先手
  - 配置中に `placement('gote')` は先手から見えない（先手確定後・後手確定前は `placement('sente')` だけ値を返し `placement('gote')` は null）
  - 非合法手の `play` は throw し、`moves.length` が変わらない
  - `undo` で局面ハッシュが 1 手前と一致
  - 千日手: 両者が飛を往復させて同じ局面を 4 回作る → `draw / repetition`
  - 連続王手の千日手: 王手をかけ続ける往復 → 王手側の負け
  - 詰みの手を指すと `ended`、`win / checkmate`
  - `layerLabel(1, 3) === '中'`, `layerLabel(4, 9) === '5層'`
  - `formatMove`: 初期局面（全部中層）で先手の歩 (7,7,1)→(7,6,2) が `▲7六歩 中→上`
  - 打ち: `▲5五角打 上`
  - `saveGame` → JSON 文字列化 → `loadGame` で棋譜・局面ハッシュが一致
  - `loadGame` は `{}`、`v: 2`、非合法手を含む棋譜で throw
- [ ] 実装してテストを通す。

### レビュー 1（Codex `gpt-6-astra`）

コア（`src/core` と `tests`）を仕様 §3・§4・§6 と突き合わせてレビューする。特に: 立体の走りの止まり方、真上真下の可否、二歩の層の扱い、打ち歩詰め、千日手の判定、3 層と 9 層の両対応。指摘は重大度順に、ファイル:行と再現する局面つきで出す。直すのは sol。

### Task 7: 3D 描画

**Files:** `src/render/*.ts`

```ts
// scene.ts
export interface BoardViewOptions { layers: number; layerGap: number }
export class BoardView {
  constructor(container: HTMLElement, opts: BoardViewOptions);
  setPieces(pieces: Array<{ sq: Square; piece: Piece }>): void;  // 差し替え（アニメーションは Task 8 の公開演出のみ）
  setHighlights(h: { selected?: Square; targets: Square[]; lastMove?: Square[]; check?: Square }): void;
  setFocusLayer(z: number | null): void;     // null で全層を通常表示、指定で他層を opacity 0.25
  setLayerGap(gap: number): void;
  setCameraPreset(p: 'oblique' | 'top' | 'side'): void;
  onPick(fn: (hit: { sq: Square } ) => void): void;  // マス（駒の上も含む）をクリック・タップ
  animateReveal(durationMs: number): Promise<void>; // 全駒を z=0 の高さから各層へ持ち上げる
  dispose(): void;
}
```

- 盤: 各層に半透明の板（opacity 0.35 程度）と 9×9 の格子線、端に筋（算用数字）と段（漢数字）のラベル。
- 駒: 五角形を押し出した形（ExtrudeGeometry）。上面に CanvasTexture で駒名（成駒は赤字）。後手は Y 軸まわりに 180°。共有ジオメトリ・駒種ごとにテクスチャをキャッシュ。
- 駒の真下に下層まで細い線（LineBasicMaterial、opacity 0.4）。
- 強調: 移動先は層ごとの半透明の正方形（緑）、選択中は黄、直前の手は薄い青、王手中の玉は赤。
- picking: Raycaster で盤の板と駒に当て、`Square` に変換。
- `camera.ts`: OrbitControls（damping あり）とプリセット。
- `ResizeObserver` でキャンバスの大きさを合わせる。`devicePixelRatio` は最大 2。
- WebGL が使えるかを返す `isWebGLAvailable(): boolean` を `scene.ts` から export。
- 確認: `npm run build` が通る。描画の見た目は Task 9 でブラウザで確かめる。

### Task 8: 画面と操作（DOM）

**Files:** `src/ui/*.ts`, `src/main.ts`, `src/style.css`

- `app.ts`: 画面の切り替え。タイトル → 交代 → 先手配置 → 交代 → 後手配置 → 公開演出 → 対局 → 終局。`Game` を持ち、`subscribe` で描き直す。
- `handoff.ts`: 「先手の番です。後手は画面を見ないでください」等の全面パネル。タップまで盤を描かない（BoardView に駒を渡さない）。
- `placement.ts`: 自分の駒だけを BoardView に渡す。駒をクリックで選択、`上/中/下` ボタン・数字キー 1〜3・選択中の駒の上下ドラッグで層を変える。「全部中層」「ランダム」「確定」。3 層以外では 1..layers のボタンを並べる。
- `hands.ts`: 両脇の持ち駒パネル（駒名と枚数）。手番側のみ選択できる。
- `promotion.ts`: 「成る / 成らない」のダイアログ（Promise を返す）。
- `log.ts`: 棋譜の一覧（`game.notation`）。最新へ自動スクロール。
- `banner.ts`: 王手・詰み・千日手・投了の表示。
- `minimap.ts`: 層の数だけ 9×9 の DOM グリッドを並べる。駒・強調表示を BoardView と同じ状態から描き、クリックで同じ選択処理を呼ぶ。スマホ幅（< 768px）では折りたたみ。
- `storage.ts`: `localStorage` キー `sanju-shogi:v1`。対局中（playing / ended）に手ごとに `saveGame` を保存。配置中は保存しない（既存の保存は新規対局の開始時に消す）。読み込み・書き込みは try/catch。読めなければ捨てる。
- 操作の流れ: 駒を選ぶ → `destinations` から合法手に絞った移動先を強調 → 移動先を選ぶ → 成りの選択肢が両方あればダイアログ → `game.play`。持ち駒を選ぶ → 打てるマスを強調 → 選ぶ → `play`。選択中の駒をもう一度押すと解除。
- 対局中のボタン: 待った、投了、視点（斜め/真上/横）、層の注目（全層/下/中/上）、層の間隔（狭/広）。
- WebGL が使えない場合: BoardView を作らず、メッセージを出して展開図だけで遊べるようにする。
- デザイン: 落ち着いた木目調の色（CSS 変数で定義）。日本語 UI。文字は `system-ui` 系と明朝の見出し。
- 確認: `npm run build` が通る。

### Task 9: 結合と確認（Claude が行う）

- `npm run dev` で起動し、内蔵ブラウザで次を通して確かめる: タイトル → 先手配置（飛を上層へ）→ 交代 → 後手配置（後手画面で先手の駒が見えない）→ 公開演出 → 数手指す（層をまたぐ手・取り・打ち・成り）→ 待った → リロードで続きから → 投了。
- スマホ幅（375px）で展開図の折りたたみと操作を確かめる。
- コンソールエラーがないこと。

### レビュー 2（Codex `gpt-6-astra`）

全体を仕様と突き合わせ、UI の状態の不整合（配置中の情報漏れ、保存のタイミング、二重送信）、Three.js の後始末、スマホの操作性を中心にレビューする。直すのは sol。

### 仕上げ

- `npm run typecheck && npm test && npm run build` が通る。
- コミット（Claude/Anthropic の署名行は入れない）。
- リポジトリ `torifo/sanju-shogi-game` の作成・push・トピック設定は、ユーザーに確認してから行う。
