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

---

## ビルド・パッケージング・インストール

### 前提条件

- **Node.js** 18 以上
- **npm** 9 以上

### 1. 依存関係のインストール

```bash
cd mdquery-vscode
npm install
```

### 2. ビルド

```bash
npm run build
```

esbuild で 2 つのバンドルが生成されます:

| 出力 | 役割 |
|---|---|
| `dist/extension.js` | Extension Host (コアロジック、Node.js環境) |
| `dist/webview.js` | Webview UI (ブラウザ環境) |

開発中はファイル監視モードも使えます:

```bash
npm run watch
```

### 3. .vsix パッケージ生成

```bash
npx vsce package --allow-missing-repository
```

`mdquery-0.1.0.vsix` がプロジェクトルートに生成されます。

> `--allow-missing-repository` は Git リモートリポジトリが未設定の場合に必要です。`package.json` に `"repository"` を設定すれば不要になります。

### 4. VS Code へのインストール

#### 方法 A: コマンドラインから

```bash
code --install-extension mdquery-0.1.0.vsix
```

#### 方法 B: VS Code の GUI から

1. `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Windows/Linux)
2. **"Extensions: Install from VSIX..."** を選択
3. 生成された `mdquery-0.1.0.vsix` を選択

インストール後、VS Code の再読み込みが促されるので **Reload Window** を実行してください。

### 5. アンインストール

```bash
code --uninstall-extension mdquery.mdquery
```

または拡張機能パネルで "MdQuery" を検索し、歯車アイコン → **アンインストール** を選択。

### 6. デバッグ実行 (開発用)

1. VS Code で `mdquery-vscode/` フォルダを開く
2. `F5` を押す (または Run and Debug パネルから **"Run Extension"**)
3. 新しい VS Code ウィンドウが開き、拡張機能が読み込まれた状態で起動
4. `.md` ファイルを開き、`Cmd+Shift+P` → **"MdQuery: Open Query Panel"**

> ファイル変更を自動検知させたい場合は、別ターミナルで `npm run watch` を並行実行してください。
