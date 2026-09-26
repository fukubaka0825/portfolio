# Design

## コンセプト

アバターのイラスト（黄色い壁・オレンジのパーカー・ティール寄りの黒髪・白いブラシの筆跡）をそのままサイトの素材にする。SNS のアイコンで知っている人が来たときに「同じ人だ」と一目で分かることを優先している。

- ヒーロー: 黄色の壁に極細の罫線が引かれ、カーソル（リング）が硬い円盤として線を押しのける。線は弦のように伸び、外れると弾けて波が伝わる。名前はカーソルに近い文字ほど細く・狭くなる（可変フォントの wght / wdth 軸）
- キャリア: LLM / Observability の仕事をしている人なので、経歴をトレースビュー（スパンのウォーターフォール）として見せる。本業と副業を並行スパンとして並べ、詳細は「副業=左 / 本業=右」の2レーン
- 肩書きの一行は、LLM のストリーミング出力のようにトークン単位で出てくる

## ヒーローの弦（`src/scripts/strings.ts`）

ヒーローに引いた罫線を「弾ける弦」として扱う小さな物理エンジン。以前の白いドライブラシは垂れ（drip）が汚く見えたため置き換えた。

- 1本の線は 8px 間隔の点列で、1D 波動方程式（`C2`）+ 減衰（`DAMP`）+ 高周波だけを殺す粘性（`VISC`）で動く。`VISC` は 0.25 未満でないと発散する
- カーソルは半径 `R` の円盤。触れた線は円盤の縁に沿って押され、`r * 0.85` 以上引っ張ると外れて弾ける（`hold` の状態遷移）
- 列ごとに線の順序と最小間隔（`MIN_GAP`）を保つので、線同士は交差せず等高線のように積み重なる。一番下の線は横罫線の上の床（`floor`）より下に行かない
- リングの大きさは毎フレーム円盤の半径から決める（CSS の transition に任せるとズレる）。円盤の内側はクリップで線を描かない
- 変位した部分だけ hoodie オレンジに発光する（変位量でバケツ分けして同じ曲線をなぞり直す）
- 止まった線（速度・変位がしきい値未満）はゼロに戻して計算を止める。何も動いていなければ rAF も止まる。ヒーローが画面外でも止まる
- 読み込み時はプロッターのように左から罫線を引き（先端にペン先の点）、見えない円盤が名前の中を一度通り抜ける
- クリック / タップで波紋。タッチは `touch-action: pan-y` で、横になぞると触れる・縦はスクロール
- `prefers-reduced-motion` では罫線を静止画として描くだけ

名前の文字は inline-block なので、そのままだと文字間で改行される。`pinLetterWidths` で既定の太さの幅に固定し（`offsetWidth` で測る。回転中の bounding rect は大きく出る）、行は `nowrap`。可変フォントの変化はグリフだけに閉じる。

## パレット（`src/styles/global.css` の `@theme`）

| トークン | 値 | 用途 |
| --- | --- | --- |
| `yolk` | `#f5d33f` | ヒーロー背景、本業のバー、強調 |
| `hoodie` | `#ee7d1c` | 副業、フッター、選択色、フォーカスリング |
| `ink` | `#0f2b2f` | 文字、キャリアセクション背景 |
| `ink-2` / `ink-3` | `#173a3f` / `#24515a` | ダーク面の段差 |
| `chalk` | `#f3f6f1` | ダーク面の文字 |
| `paper` | `#ffffff` | 明るい面の背景 |
| `mist` | `#5f7b7e` | 補助テキスト |
| `line` | `#dbe3e1` | 罫線 |

`hoodie` の上に `chalk` の小さい文字は置かない（コントラスト不足）。オレンジ面の文字は `ink`。

## タイポグラフィ

- Bricolage Grotesque Variable（欧文・見出し・UI）。`display` ユーティリティで見出し用の字間・行送り
- Zen Kaku Gothic New（和文本文。欧文フォントのフォールバックとして自動で当たる）
- 見出しは `clamp()` で画面幅に追従。本文は 1rem / 行送り 1.9 前後
- 和文の改行は `text-wrap: pretty` + `word-break: auto-phrase`（`global.css` の base）で、1〜2文字だけの行や助詞始まりの行を避ける

### フォントの読み込み（パフォーマンス上の決まり）

- Bricolage の latin サブセット（`bricolage-grotesque-latin-standard-normal.woff2`）は `Base.astro` で `preload` する。ヒーローの初回描画がこのフォントで決まるため
- フォールバックは `global.css` の `Bricolage Fallback`（Arial に `size-adjust` / `ascent-override` などを当てたもの）。数値は Chromium で Bricolage と Arial の字幅・メトリクスを実測して決めた。フォントを差し替えたら測り直す
- Zen Kaku Gothic は `src/styles/jp-font.css` に分け、`media="print" onload` で**非ブロッキング**に読む（unicode-range のブロックが約240個あり、`global.css` に入れると CSS が 331KB になって初回描画を止めていた）。読み込み中はシステムの和文フォント（Hiragino / Noto Sans JP / Yu Gothic）で表示される
- `global.css` に和文フォントの `@import` を戻さないこと

## モーションの原則

- 自動で動くのはページ読み込み時の1回（名前の立ち上がり → 肩書きのストリーミング）と、ヒーローの罫線の演出のヒントだけ
- それ以外はユーザーの操作（カーソル、スクロール、ボタン）への応答として動く
- `prefers-reduced-motion: reduce` では Lenis・GSAP の演出・view transition をすべて止める。JS が無くても全テキストがHTMLにある
- GSAP はトップページだけで読む。`src/scripts/env.ts`（reducedMotion など）と `smooth.ts`（Lenis・ナビ）は GSAP に依存させない。ブログ・タグ・記事ページで GSAP を import しないこと（E2E が検査している）
- アニメーションは transform / opacity / font-variation のみ。レイアウトを揺らさない

## アクセシビリティ

- スキップリンク、`:focus-visible` のリング（hoodie。オレンジのフッター内だけ ink）
- ページ内リンク（スキップリンク・ナビ）はスクロール後に移動先へフォーカスも移す（`smooth.ts`）。次の Tab が移動先から続く
- 装飾の canvas / プレビュー画像 / トレースのツールチップは `aria-hidden`。バーは同じ内容を `aria-label` に持つ
- トレースのバーはリンク。キーボードフォーカス（`:focus-visible`）のときだけカードをハイライトする（タップでは点灯させない。スマホで暗転が残るため）
- ナビのピルは ink 色なので、ink のセクション（`data-surface="dark"`）の上では明るい面（ink-3 + 枠線）に切り替わる
- 小さい文字の hoodie は、ダーク面では `hoodie-lit`、白地では `hoodie-deep` を使う（素の hoodie はどちらでも AA 未満）
