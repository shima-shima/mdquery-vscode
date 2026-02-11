# MdQuery VS Code Extension — AI エージェント向けガイダンス

## 概要

Markdown の箇条書きに埋め込まれた `#tag` `@key(val)` `key:val` `<!-- k:v -->` 形式のメタデータを抽出し、独自クエリ言語でフィルタリングする VS Code 拡張機能。

姉妹プロジェクト `../mdquery-web/` の Next.js Web アプリを移植したもの。コアロジック (`markdown-parser.ts`, `query-filter.ts`) は共通。

## ファイル構成と役割

| ファイル | 役割 | 変更頻度 |
|---|---|---|
| `src/extension.ts` | エントリポイント。コマンド登録、ステータスバー。 | 低 |
| `src/panel-provider.ts` | WebviewPanel 生成、HTML/CSSテンプレート、メッセージング、デコレーション。 | 中 |
| `src/webview/main.ts` | Webview 内 UI ロジック (Vanilla TS)。4タブ描画。 | **高** |
| `src/lib/markdown-parser.ts` | Markdown → `ParsedItem[]` ツリー。 | 低 |
| `src/lib/query-filter.ts` | クエリパーサー + フィルタエンジン。 | 低 |
| `preview/generate.mjs` | Webview UI のブラウザプレビュー HTML 生成。 | 低 |

## ビルド

```bash
npm run build   # dist/extension.js + dist/webview.js を生成
npm run watch   # ファイル監視モード
```

## Webview UI のブラウザプレビュー

VS Code 拡張の Webview はブラウザでは直接確認できないが、以下の手順で **スクリーンショットで確認可能なプレビューページ** を生成できる。

### 手順

```bash
# 1. ビルド (必須: dist/webview.js を生成)
npm run build

# 2. プレビュー HTML を生成
node preview/generate.mjs

# 3. プロジェクトルートをドキュメントルートとして HTTP サーバーを起動
#   (※ preview/ ではなくプロジェクトルート。webview.js を ../dist/ で参照するため)
busybox httpd -f -p 8001 -h . &

# 4. ブラウザで開く
#   http://localhost:8001/preview/index.html
```

### プレビューの仅組み

`preview/generate.mjs` が以下を自動的に行う:

1. `panel-provider.ts` の `getHtml()` から **CSS** と **HTML テンプレート** を正規表現で抽出
2. VS Code テーマ CSS 変数 (`--vscode-*`) の **ダークテーマモック値** を注入
3. `acquireVsCodeApi()` の **モック実装** を定義 (`postMessage` は console.log に出力)
4. ビルド済み `dist/webview.js` を `<script src>` で読み込み
5. **サンプルデータ** を `postMessage` で Webview に注入

→ 結果、ブラウザだけで VS Code Webview と同じ見た目のページが表示される。

### 重要な制約

- HTTP サーバーのドキュメントルートは **プロジェクトルート** にすること。`preview/index.html` が `../dist/webview.js` を相対パスで参照するため。
- `preview/index.html` は `.gitignore` に含まれており、毎回 `node preview/generate.mjs` で再生成する。
- プレビューのモックデータを変更したい場合は `preview/generate.mjs` 内の `items` 配列を編集する。

## UI 変更時のワークフロー

Webview UI を変更する際は、以下のサイクルでスクリーンショット確認しながら進める:

```
1. src/panel-provider.ts の CSS や src/webview/main.ts の描画ロジックを編集
2. npm run build
3. node preview/generate.mjs
4. ブラウザで http://localhost:8001/preview/index.html を確認
5. スクリーンショットで見た目を検証
6. 問題があれば 1 に戻る
```

### 変更対象と影響範囲

| やりたいこと | 変更対象 | プレビューで確認可能か |
|---|---|---|
| CSS スタイル変更 | `panel-provider.ts` の `<style>` ブロック | ✅ はい |
| タブの描画ロジック変更 | `webview/main.ts` の `render*` 関数群 | ✅ はい |
| HTML テンプレート変更 | `panel-provider.ts` の `getHtml()` | ✅ はい |
| メッセージプロトコル変更 | `panel-provider.ts` + `webview/main.ts` | ⚠ モックデータ更新が必要 |
| エディタデコレーション | `panel-provider.ts` | ❌ 確認不可 |
| ステータスバー | `extension.ts` | ❌ 確認不可 |

## セキュリティ制約

- `eval()` / `new Function()` によるユーザー入力の評価は禁止。
- Webview の CSP (Content Security Policy) を維持すること。

## Web アプリとの同期

`src/lib/markdown-parser.ts` と `src/lib/query-filter.ts` は `../mdquery-web/src/lib/` と同一内容。Web アプリ側で変更があった場合はコピーするだけで動く。
