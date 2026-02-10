# MdQuery — VS Code Extension

Markdown の笇条書きに埋め込まれた `#tag` `@key(val)` `key:val` `<!-- k:v -->` 形式のメタデータを抽出し、独自クエリ言語でフィルタリングする VS Code 拡張機能です。

## Features

- **リアルタイムフィルタリング**: エディタで Markdown を編集すると、即座にフィルタ結果が更新
- **4つのビュー**: Markdown / Filtered List / Data Table / Raw JSON
- **行ジャンプ**: フィルタ結果をクリックするとエディタの該当行に移動
- **ハイライト**: マッチした行をエディタ内でハイライト表示
- **ステータスバー**: マッチ数をリアルタイム表示

## クエリ構文

| 構文 | 例 | 説明 |
|---|---|---|
| `#tag` | `#backend` | タグ検索 |
| `@key(value)` | `@priority(high)` | メタデータ検索 |
| `key:value` | `cost:5000` | コロンKV検索 |
| `key>value` | `cost>3000` | 比較 |
| `key<today+30` | `due<today+30` | 相対日付 (today/today±N) |
| `checked:true` | | チェックボックス状態 |
| `!expr` | `!#draft` | 否定 |
| `スペース` | `#backend @priority(high)` | AND |
| `OR` | `#frontend OR #design` | OR |

## 見出し対応

- h2〜h4 の見出しはツリーノードとしてパースされ、配下のリストを子として保持
- 見出し自体にも `#tag` や `@key(val)` を埋め込める
- h1 はタイトルとみなしフィルタ対象外

## Usage

1. Markdown ファイルを開く
2. `Cmd+Shift+P` (or `Ctrl+Shift+P`) → "MdQuery: Open Query Panel"
3. クエリを入力してフィルタリング

## Configuration

| 設定 | デフォルト | 説明 |
|---|---|---|
| `mdquery.debounceMs` | `200` | 変更検知のデバウンス時間 |
| `mdquery.presetQueries` | `[]` | プリセットクエリのリスト |
