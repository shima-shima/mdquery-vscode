# Web 版と VS Code 拡張機能版の同期戦略

## 現状の問題

現在、両プロジェクトは完全に独立しており、4つの乖離リスクがある:

| カテゴリ | 現状 | リスク |
|---|---|---|
| **コアロジック** | 手動コピーで同期 | コピーし忘れでバージョンが乖離 |
| **描画ロジック** | React と Vanilla TS で完全に別実装 | 同じ機能の二重実装・微妙な見た目の差異 |
| **サジェスト** | Web: Reactコンポーネント / VSCode: Vanilla TS | ロジック重複 |
| **CSS** | Tailwind vs VS Code CSS変数 | スタイルの微妙な差異 |

## 提案: 3つのレベル

工数の少ない順に提案する。すべてを一度にやる必要はなく、Level 1 だけでも十分な効果がある。

---

### Level 1: 乖離検知の自動化 (推奨・即日可能)

**方針**: 今のプロジェクト構成を変えず、「差異が生じたら気づく」仕組みだけ作る。

#### 1a. コアロジックの同一性チェックスクリプト

```bash
#!/bin/bash
# scripts/check-sync.sh
set -e
WEB=../mdquery-web/src/lib
VSC=./src/lib
FILES="markdown-parser.ts query-filter.ts"
for f in $FILES; do
  if ! diff -q "$WEB/$f" "$VSC/$f" > /dev/null 2>&1; then
    echo "❌ $f is out of sync"
    diff --stat "$WEB/$f" "$VSC/$f"
    exit 1
  fi
  echo "✅ $f is in sync"
done
echo "All core files in sync."
```

- `npm run check-sync` で手動実行
- 将来的には CI (GitHub Actions) で自動実行

#### 1b. コアロジックのユニットテスト共有

テストを片方のプロジェクトに書き、もう片方のファイルに対しても実行する:

```typescript
// tests/markdown-parser.test.ts
import { parseMarkdown } from '../src/lib/markdown-parser';
// 同じテストが両プロジェクトのファイルに対してパスすることを保証
```

#### 1c. 描画結果のスナップショットテスト

同じデータを入力したときの HTML 出力が「構造的に同じ」であることを検証:

```typescript
// 両者の描画関数が生成する HTML から「構造」を抽出して比較
// - テキスト内容が同じか
// - タグ/メタバッジの数が同じか
// - テーブルの行数/列数が同じか
// (クラス名やCSSの差異は無視)
```

---

### Level 2: 描画ロジックの共通化 (効果大・中規模改修)

**方針**: 「データ→HTML文字列」の変換ロジックを1箇所にまとめ、両プロジェクトで共有する。

#### 現状の構造

```
Web:     ParsedItem[] → React JSX    → DOM
VSCode:  ParsedItem[] → HTML文字列    → innerHTML
```

#### 提案構造

```
共通:    ParsedItem[] → HTML文字列    ← 新規 src/lib/renderers.ts
Web:                    HTML文字列 → dangerouslySetInnerHTML
VSCode:                 HTML文字列 → innerHTML
```

#### 具体的な共通化対象

```typescript
// src/lib/renderers.ts  (新規ファイル)
//
// 純粋TypeScript。ReactにもDOMにも依存しない。
// 入力: ParsedItem[] + 設定
// 出力: HTML文字列

export interface RenderOptions {
  ancestorLines: Set<number>;
  metaKeys: string[];
  onLineClick?: string;  // e.g., "goToLine(${line})"
}

/** MarkdownタブのコンテンツHTML */
export function renderMarkdownView(
  items: ParsedItem[],
  opts: RenderOptions
): string;

/** Data TableタブのコンテンツHTML */
export function renderTableView(
  items: ParsedItem[],
  opts: RenderOptions
): string;

/** サジェストドロップダウンHTML */
export function renderSuggestList(
  items: SuggestItem[],
  selectedIdx: number
): string;

/** バッジHTML生成 */
export function renderTagBadge(tag: string): string;
export function renderMetaBadge(key: string, value: string): string;
export function renderCheckIcon(checked: boolean | null): string;
```

#### 移行計画

1. VS Code側の `main.ts` から描画関数を `renderers.ts` に抽出
   - 既に HTML 文字列を返す形式なので、ほぼそのまま移動できる
   - 対象: `mdLinesHtml`, `renderTableTabの内部`, `checkIconHtml`, `tagBadgesHtml`, `metaBadgesHtml`, `flattenItems`
2. VS Code側から `renderers.ts` を import して動作確認
3. Web側の各タブコンポーネントを `renderers.ts` の HTML + `dangerouslySetInnerHTML` に置換
4. サジェストの `buildSuggestions()` も `renderers.ts` に移動

#### メリット

- 描画の「構造」が完全に一致 (同じ HTML を生成)
- 機能追加時に 1箇所だけ変更すればよい
- テストが容易 (純粋な string → string 関数)

#### デメリット

- Web側で `dangerouslySetInnerHTML` を使うことになる
  - ただし、入力は全て自前パーサー経由の ParsedItem なので、XSS リスクは `esc()` で制御可能
- React のイベントハンドラを使えなくなる (onClick 等)
  - `data-*` 属性 + イベント委譲で対応

---

### Level 3: モノレポ化 (拜本的解決・大規模改修)

**方針**: 2つのプロジェクトを1つのモノレポに統合する。

```
mdquery/
├── packages/
│   ├── core/              ← markdown-parser, query-filter, renderers
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   ├── web/               ← Next.js app (imports @mdquery/core)
│   │   ├── src/
│   │   └── package.json
│   └── vscode/            ← VS Code extension (imports @mdquery/core)
│       ├── src/
│       └── package.json
├── package.json           ← workspace root
└── turbo.json / pnpm-workspace.yaml
```

#### core パッケージの内容

```
@mdquery/core/
├── markdown-parser.ts   ← 現行と同じ
├── query-filter.ts      ← 現行と同じ
├── renderers.ts         ← Level 2 で抽出したもの
├── suggest.ts           ← buildSuggestions()
└── types.ts             ← ParsedItem, FilterResult 等
```

#### ツールチェーン

- **pnpm workspaces** + **turborepo** または **npm workspaces**
- `pnpm -F @mdquery/core test` → コアのテスト
- `pnpm -F web build` → Next.js ビルド
- `pnpm -F vscode build` → esbuild バンドル

#### メリット

- コアロジックのコピーが完全に不要になる
- 型定義が自動的に共有される
- CI で全パッケージを一括テスト・ビルド

#### デメリット

- 初期セットアップコストが大きい
- esbuild で `@mdquery/core` をバンドルする設定が必要
- 2人以上で開発しない限り過剰設計の可能性

---

## 推奨ロードマップ

```
今すぐ        Level 1a  同期チェックスクリプト
  │
  ↓
次の機能追加時  Level 2   renderers.ts 抽出
  │                   (機能追加と同時にやると効率的)
  ↓
規模拡大時    Level 3   モノレポ化
                   (パッケージが3つ以上になったら検討)
```

## 参考: 現時点の共有可能なファイル一覧

| ファイル | 現状 | Level 2 後 |
|---|---|---|
| `markdown-parser.ts` | コピーで同期 | 共有 |
| `query-filter.ts` | コピーで同期 | 共有 |
| `renderers.ts` | 存在しない | **新規** → 共有 |
| `suggest.ts` (buildSuggestions) | Web: query-suggest.tsx / VSCode: main.ts | **抽出** → 共有 |
| `types.ts` | 各ファイル内に重複定義 | **抽出** → 共有 |
| UI フレームワーク固有部分 | 別々 | 別々 (最小化) |
