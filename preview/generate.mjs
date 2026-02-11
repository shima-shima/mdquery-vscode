/**
 * Extract the Webview HTML from panel-provider.ts and generate
 * a standalone preview page with mock data.
 *
 * Usage: node preview/generate.mjs
 * Then open preview/index.html in a browser.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Read the panel-provider source to extract CSS
const providerSrc = readFileSync(resolve(root, 'src/panel-provider.ts'), 'utf-8');

// Extract the <style>...</style> block
const styleMatch = providerSrc.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) { console.error('Could not extract <style> from panel-provider.ts'); process.exit(1); }
const cssBlock = styleMatch[1];

// Extract the <body>...</body> block
const bodyMatch = providerSrc.match(/<body>([\s\S]*?)<script/);
if (!bodyMatch) { console.error('Could not extract <body> from panel-provider.ts'); process.exit(1); }
const bodyBlock = bodyMatch[1];

// Mock VS Code theme variables (dark theme)
const mockVars = `
    --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --vscode-font-size: 13px;
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    --vscode-sideBar-background: #252526;
    --vscode-panel-border: #3c3c3c;
    --vscode-descriptionForeground: #8a8a8a;
    --vscode-input-border: #3c3c3c;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-placeholderForeground: #6a6a6a;
    --vscode-focusBorder: #007acc;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-tab-inactiveBackground: #2d2d2d;
    --vscode-tab-inactiveForeground: #8a8a8a;
    --vscode-tab-activeBackground: #1e1e1e;
    --vscode-tab-activeForeground: #ffffff;
    --vscode-tab-hoverBackground: #2a2d2e;
    --vscode-tab-activeBorderTop: #007acc;
    --vscode-badge-background: #4d78cc;
    --vscode-badge-foreground: #ffffff;
    --vscode-textBlockQuote-background: #2a2d2e;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-testing-iconPassed: #73c991;
    --vscode-errorForeground: #f48771;
    --vscode-inputValidation-errorBackground: #5a1d1d;
    --vscode-inputValidation-errorBorder: #be1100;
    --vscode-textLink-foreground: #3794ff;
`;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>MdQuery Webview Preview</title>
  <style>
    :root {${mockVars}}
    ${cssBlock}
  </style>
</head>
<body>
  ${bodyBlock}
  <script>
    // Mock acquireVsCodeApi BEFORE loading webview script
    window.acquireVsCodeApi = function() {
      return {
        postMessage(msg) { console.log('[postMessage]', JSON.stringify(msg)); },
        getState() { return null; },
        setState(s) {},
      };
    };
  </script>
  <script src="../dist/webview.js"></script>
  <script>
    // Inject mock data after webview script loads
    setTimeout(() => window.postMessage({
      type: 'filterResult',
      items: [
        {
          text: 'バックエンド',
          rawLine: '## バックエンド #backend',
          tags: ['backend'],
          meta: {},
          checked: null,
          line: 3,
          headingLevel: 2,
          children: [
            {
              text: 'APIエンドポイントの設計',
              rawLine: '- [ ] APIエンドポイントの設計 #design @priority(high) @due(2024-04-01)',
              tags: ['design'],
              meta: { priority: 'high', due: '2024-04-01' },
              checked: false,
              line: 5,
              children: [
                {
                  text: 'REST APIのルーティング設計',
                  rawLine: '  - [ ] REST APIのルーティング設計 @priority(high) @assignee(田中)',
                  tags: [],
                  meta: { priority: 'high', assignee: '田中' },
                  checked: false,
                  line: 6,
                },
              ],
            },
            {
              text: 'データベーススキーマの作成',
              rawLine: '- [x] データベーススキーマの作成 @priority(high) cost:5000',
              tags: [],
              meta: { priority: 'high', cost: '5000' },
              checked: true,
              line: 8,
            },
          ],
        },
        {
          text: 'フロントエンド',
          rawLine: '## フロントエンド #frontend',
          tags: ['frontend'],
          meta: {},
          checked: null,
          line: 20,
          headingLevel: 2,
          children: [
            {
              text: 'UIコンポーネントの作成',
              rawLine: '- [ ] UIコンポーネントの作成 @priority(high) @due(2024-03-20)',
              tags: [],
              meta: { priority: 'high', due: '2024-03-20' },
              checked: false,
              line: 22,
            },
            {
              text: 'ダークモード対応',
              rawLine: '- [ ] ダークモード対応 @priority(low)',
              tags: [],
              meta: { priority: 'low' },
              checked: false,
              line: 25,
            },
          ],
        },
      ],
      error: null,
      totalCount: 7,
      matchedCount: 7,
      ancestorLines: [],
      metaKeys: ['priority', 'due', 'cost', 'assignee'],
      allTags: ['backend', 'design', 'frontend'],
      query: '',
    }, '*'), 100);
  </script>
</body>
</html>`;

writeFileSync(resolve(__dirname, 'index.html'), html);
console.log('Preview generated: preview/index.html');
