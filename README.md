# 三重将棋

9×9×3 層の盤で遊ぶ、ローカル 2 人対戦の立体将棋です。

## 遊び方（完成時）

1. 先手・後手が交代で、自分の 20 枚の駒を置く層を秘密に決めます。
2. 配置を同時に公開し、通常の将棋の動きに上下の層への移動を組み合わせて指します。
3. 相手の玉を詰ませれば勝ちです。持ち駒・成り・待ったにも対応します。

現在はルールエンジンまでの実装です。画面には「三重将棋」のみ表示します。

## 開発

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
```

Node.js 22.12 以上を使用します。`BASE_PATH=/sanju-shogi-game/ npm run build` で
GitHub Pages の公開パスに合わせてビルドできます。
