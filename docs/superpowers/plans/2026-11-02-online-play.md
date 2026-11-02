# 三重将棋 オンライン対戦 実装計画

> **実装者へ:** 仕様は `docs/superpowers/specs/2026-11-02-online-play-design.md`。食い違いは仕様を優先し報告する。TDD。`npm run typecheck && npm test && npm run build` が通る状態で終える。**git commit はしない**。

**Goal:** 招待リンクで 2 人がオンライン対戦できるようにする（GitHub Pages のまま、Trystero の Nostr 方式）。

**分担:** 実装 = Codex `gpt-6.1-sol`（段階1: N1〜N3、段階2: N4〜N6）。レビュー = `gpt-6-astra`。

---

### N1: protocol.ts と roomKey.ts（純粋関数）

- `NetMessage` の判別共用体（仕様 §4 の表のとおり）と `parseMessage(raw: unknown): NetMessage | null`（形・型・範囲を検証。`move` は `decodeMove` が通るか、`assignment` は長さ 20 の整数配列か、`hash` は 64 桁の 16 進か）。
- `commitHash(assignment, salt): Promise<string>`（Web Crypto の SHA-256。Node 22 の `globalThis.crypto.subtle` でテスト可能）と `randomSalt()`。
- `SyncState { layers, placements: { sente, gote } | null, moves: string[], result?: … }` と `mergeSync(local, remote): { kind: 'same' } | { kind: 'adopt-remote' } | { kind: 'keep-local' } | { kind: 'conflict' }`。
- `roomKey.ts`: `createRoomKey()`（128 bit → base64url 22 文字）、`buildInviteUrl(baseUrl, key)`、`readRoomKey(hash: string): string | null`（`#room=` を読み取り、形が違えば null）、`roomNameFor(key): Promise<string>`（SHA-256 の先頭 16 文字）。
- テスト: 正しいメッセージは通り、欠けた・余計な・型違い・範囲外は null。同じ入力の commitHash は一致し salt が違えば変わる。mergeSync の 4 通り。roomKey の往復と不正な hash の拒否。

### N2: memoryTransport.ts と session.ts

- `Transport` インターフェース（仕様 §7）。`createMemoryPair(): [Transport, Transport]`（非同期に配送。`disconnect()` / `reconnect()` でテストから切断を再現できる）。3 人目を試すため `createMemoryRoom()` で任意人数をつなげる形でもよい。
- `OnlineSession`（`role: 'host' | 'guest'`, `hostColorChoice: Color | 'random'`（host のみ）, `transport`, `config`, `storage?`）。
  - 公開する状態: `status: 'waiting' | 'connected' | 'placing' | 'waiting-commit' | 'revealing' | 'playing' | 'ended' | 'disconnected' | 'error'`、`myColor`、`game: Game`、`error?: string`、`pendingUndo?`。
  - 操作: `submitPlacement(assignment)`、`play(move)`、`requestUndo()`、`replyUndo(accepted)`、`resign()`、`dispose()`。
  - 通知: `subscribe(fn)`。
  - 相手の手は `parseMessage` → `game.play`（例外なら `error` を送って status=error）。自分の手番以外の `play` は拒否。
- テスト（偽 Transport の組）: 仕様 §8 の Vitest 項目すべて。

### N3: storage.ts（部屋ごとの保存）と再開

- `saveRoom(key, state)` / `loadRoom(key)` / `clearRoom(key)`。キーは `sanju-shogi:online:<roomKey>`。try/catch で、使えなくても続行。
- `OnlineSession` が状態の変わるたびに保存し、生成時に保存があれば読み込んで `hello.resume` に載せる。
- テスト: 配置確定後に切断 → 再接続で続行、対局中に片方だけが 1 手進んだ状態での再接続 → 長いほうに合わせる、食い違いで conflict。

### N4: transport.ts（Trystero 実装）

- `createTrysteroTransport(roomKey): Promise<Transport>`。`await import('@trystero-p2p/nostr')`、`joinRoom({ appId: 'sanju-shogi-game', password: roomKey }, await roomNameFor(roomKey))`、`room.makeAction('msg')`、`onPeerJoin` / `onPeerLeave`、`leave()`。インストールされた版の API を確認して合わせる（パッケージ名・型が違えば報告）。
- 最初の peer だけを相手とし、それ以外の peer には `full` を送って無視する（宛先指定の送信を使う）。
- リレー接続の失敗・20 秒のタイムアウトを UI に伝えられるようにする。

### N5: UI

- タイトルに「オンライン対戦」ボタン。押すと「部屋を作る」画面（先手 / 後手 / ランダム、作成）。
- 待機画面: リンク、コピー、共有（`navigator.share` があるとき）、「相手を待っています」。
- 起動時に `location.hash` に `#room=` があれば、guest として接続中画面へ（host の保存があれば host として再開）。
- 配置・対局画面はローカルと同じ部品を使い、オンラインでは交代画面を出さない、相手番は操作不可、相手の待ったの申し入れは承認ダイアログ、切断中はバナー、エラーは仕様 §6 の文言。
- 終局後・タイトルへ戻るとき `history.replaceState` で `#room=` を消し、Transport を `leave()`。
- Trystero を含むオンライン部分は動的 import（ローカルの初期読み込みを増やさない）。

### N6: README と仕様の更新

- README にオンライン対戦の遊び方と限界（仕様 §9）を追記。
- 元の仕様 `2026-10-31-sanju-shogi-design.md` の §1「やらないこと」からオンライン対戦を外し、この設計書へのリンクを足す。

### 確認（Claude）

- 同じブラウザの 2 タブで、本物のリレー経由で 1 局通す。片方を再読み込みして続きから再開。

### レビュー（astra）

- 秘密配置（コミット前に相手の配置が漏れないか、reveal の検証）、メッセージ検証、切断・再開の整合、二重送信、Trystero の後始末、エラー表示を中心に。
