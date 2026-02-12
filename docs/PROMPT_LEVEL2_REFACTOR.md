# Level 2 描画ロジック共通化 — Shelley 実行用プロンプト

> 以下のプロンプトを Shelley にそのまま渡してください。

---

## プロンプト本文

```
MdQuery プロジェクトの Web 版 (/home/exedev/mdquery-web) と VS Code 拡張版
(/home/exedev/mdquery-vscode) で、描画ロジックを共通化するリファクタリングを実行してください。

## 背景

現在、両プロジェクトは同じデータから同じ見た目の HTML を生成していますが、
描画ロジックが別々に実装されています:
- Web: React JSX (page.tsx, query-suggest.tsx)
- VSCode: Vanilla TS で HTML 文字列を生成 (webview/main.ts)

これを「純粋 TS で HTML 文字列を返す共通モジュール」に抽出し、
両方から使うようにしてください。

## ゴール

1. 新規ファイル `src/lib/renderers.ts` を作成
2. 新規ファイル `src/lib/suggest.ts` を作成
3. 両プロジェクトがこれらを import して使う
4. 両プロジェクトがビルド・動作することを確認
5. `npm run check-sync` がパスすることを確認

## ステップ 1: renderers.ts の作成

VSCode 側の webview/main.ts から以下の関数を抽出し、
`src/lib/renderers.ts` に移動してください。

抽出対象関数:
- esc(s: string): string
- checkIconHtml(checked: boolean | null): string
- tagBadgesHtml(tags: string[]): string
- metaBadgesHtml(meta: Record<string, string>): string
- collectRawLines(items: ParsedItem[]): string[]
- mdLinesHtml(items: ParsedItem[], ancestorLines: Set<number>): string
- flattenItems(items, depth?, ancestorLines?): FlatItem[]
- renderTableHtml(items: ParsedItem[], metaKeys: string[], ancestorLines: Set<number>): string
- emptyHtml(icon: string): string

制約:
- React, DOM API, vscode API に依存しないこと (markdown-parser.ts への依存のみ許可)
- 全関数を export すること
- ancestorLines は Set<number> を引数で受け取ること (グローバル変数に依存しない)
- ParsedItem, FlatItem 型は markdown-parser.ts から import すること

## ステップ 2: suggest.ts の作成

VSCode 側の main.ts と Web 側の query-suggest.tsx に重複している
サジェストロジックを `src/lib/suggest.ts` に抽出してください。

抽出対象:
- SuggestItem インターフェース
- getTokenAtCursor(value: string, cursor: number): { token, start, end }
- buildSuggestions(token, tags, metaKeys, metaValues): SuggestItem[]

制約:
- DOM API に依存しないこと
- Web 側の query-suggest.tsx の buildSuggestions のロジックを正とする
  (否定プレフィックス対応、カテゴリヒント表示等が完全。
  VSCode 側は簡略化されているので、Web 側ベースで統一する)

## ステップ 3: VSCode 拡張側の書き換え

`/home/exedev/mdquery-vscode/src/webview/main.ts` を書き換えて、
renderers.ts と suggest.ts から import するようにしてください。

- 抽出した関数のローカル定義を削除し、import に置換
- UI イベントハンドリング、postMessage 通信、保存フィルタ UI は
  main.ts に残す (これらはプラットフォーム固有)

確認:
- `cd /home/exedev/mdquery-vscode && npm run build` が成功すること
- `node preview/generate.mjs` でプレビュー生成後、
  ブラウザで http://localhost:8001/preview/index.html を確認し、
  スクリーンショットで見た目が変わっていないことを検証

## ステップ 4: Web アプリ側の書き換え

### 4a. 共通ファイルの配置

`renderers.ts` と `suggest.ts` を Web 側にもコピー:
```bash
cp /home/exedev/mdquery-vscode/src/lib/renderers.ts /home/exedev/mdquery-web/src/lib/renderers.ts
cp /home/exedev/mdquery-vscode/src/lib/suggest.ts /home/exedev/mdquery-web/src/lib/suggest.ts
```

### 4b. page.tsx の書き換え

`/home/exedev/mdquery-web/src/app/page.tsx` 内の以下の React コンポーネントを、
renderers.ts の HTML 文字列 + dangerouslySetInnerHTML に置換:

| 現行 React コンポーネント | 置換後 |
|---|---|
| MdView / MdLines | renderers.ts の mdLinesHtml() + dangerouslySetInnerHTML |
| TableView / Th | renderers.ts の renderTableHtml() + dangerouslySetInnerHTML |
| TagBadge | renderers.ts の tagBadgesHtml() (内部利用のみ) |
| MetaBadge | renderers.ts の metaBadgesHtml() (内部利用のみ) |
| CheckIcon | renderers.ts の checkIconHtml() (内部利用のみ) |
| Empty | renderers.ts の emptyHtml() |

先に削除されたが page.tsx にまだ残っているコンポーネントはそのまま:
- SaveFilterButton, SavedFilterChip (プラットフォーム固有 UI)
- CopyJsonButton (プラットフォーム固有 UI)
- Home コンポーネント自体 (レイアウト)

### 4c. query-suggest.tsx の書き換え

`/home/exedev/mdquery-web/src/components/query-suggest.tsx` 内の
`buildSuggestions()` と `getTokenAtCursor()` を削除し、
`suggest.ts` から import に置換。
React コンポーネント `QuerySuggestInput` 自体はそのまま残す。

### 4d. CSS の調整

renderers.ts が生成する HTML は CSS クラス名を使う。
Web 側では globals.css または page.tsx 内に対応する CSS を追加する。
VSCode 側では panel-provider.ts の <style> ブロックに既にある。

重要: renderers.ts の HTML が使うクラス名を両方で揃えること。
VSCode 側の panel-provider.ts の <style> 内のクラス名を正とし、
Web 側の globals.css に同名のクラスを追加する。
スタイルの値はそれぞれのデザインシステムに合わせる
(VSCode: --vscode-* CSS 変数, Web: hsl(var(--*)) 変数)。

確認:
- `cd /home/exedev/mdquery-web && npx next build` が成功すること
- `npx next dev -p 8000` で起動し、ブラウザで http://localhost:8000 を確認、
  スクリーンショットで見た目が変わっていないことを検証

## ステップ 5: 同期確認

全共通ファイルが一致することを確認:
```bash
diff /home/exedev/mdquery-web/src/lib/renderers.ts /home/exedev/mdquery-vscode/src/lib/renderers.ts
diff /home/exedev/mdquery-web/src/lib/suggest.ts /home/exedev/mdquery-vscode/src/lib/suggest.ts
diff /home/exedev/mdquery-web/src/lib/markdown-parser.ts /home/exedev/mdquery-vscode/src/lib/markdown-parser.ts
diff /home/exedev/mdquery-web/src/lib/query-filter.ts /home/exedev/mdquery-vscode/src/lib/query-filter.ts
```

check-sync スクリプトも更新して renderers.ts と suggest.ts をチェック対象に追加:
`/home/exedev/mdquery-vscode/scripts/check-sync.sh` の FILES 変数に
`renderers.ts suggest.ts` を追加。

## ステップ 6: コミット

各プロジェクトでそれぞれコミットしてください。

## 禁止事項

- renderers.ts / suggest.ts に DOM API (document, window) を使わないこと
- renderers.ts / suggest.ts に React を使わないこと
- renderers.ts / suggest.ts に vscode API を使わないこと
- eval() / new Function() を使わないこと
- 見た目を変えないこと (リファクタのみ、機能追加なし)

## 作業順序

VSCode 側を先に完成させ、プレビューで確認してから Web 側に進むこと。
VSCode 側は既に HTML 文字列生成なので、抽出が容易。
Web 側は React JSX → HTML 文字列の変換が必要なので、注意深く進める。
```

---

## プロンプトの設計意図 (参考)

### なぜこの順序か

1. **VSCode 側から抽出**: 既に HTML 文字列を返す形式なので、関数を別ファイルに移動するだけ
2. **VSCode 側で検証**: プレビューでスクリーンショット確認が容易
3. **Web 側に適用**: React JSX を dangerouslySetInnerHTML に置換する部分が難度高

### リスクポイント

- **イベントハンドラ**: dangerouslySetInnerHTML では onClick 等が使えない。
  `data-line` 属性 + イベント委譲 で対応する必要がある。
  VSCode 側で既にこのパターンを使っているので、それを踏襲する。
- **CSS クラス名**: renderers.ts の HTML が使うクラス名を両プロジェクトで揃える必要あり。
  VSCode 側の既存クラス名を正とする指示を含めている。
