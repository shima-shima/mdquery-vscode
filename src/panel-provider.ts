import * as vscode from 'vscode';
import * as path from 'path';
import { parseMarkdown, countItems, getAllMetaKeys, getAllTags, getAllMetaValues, type ParsedItem } from './lib/markdown-parser';
import { filterItems, type FilterResult } from './lib/query-filter';

export class MdQueryPanelProvider {
  private static instance: MdQueryPanelProvider | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private parsed: ParsedItem[] = [];
  private currentQuery = '';
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private matchDecoration: vscode.TextEditorDecorationType;
  private ancestorDecoration: vscode.TextEditorDecorationType;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    statusBarItem: vscode.StatusBarItem
  ) {
    this.statusBarItem = statusBarItem;

    // Decorations
    this.matchDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      isWholeLine: true,
    });
    this.ancestorDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      opacity: '0.4',
      isWholeLine: true,
    });

    // Create panel
    this.panel = vscode.window.createWebviewPanel(
      'mdqueryPanel',
      'MdQuery',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = this.getHtml();

    // Listen to messages from webview
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onWebviewMessage(msg),
      undefined,
      this.disposables
    );

    // Listen to editor changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === 'markdown') {
          this.debouncedUpdate(e.document);
        }
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'markdown') {
          this.updateFromDocument(editor.document);
        }
      })
    );

    // Cleanup on dispose
    this.panel.onDidDispose(
      () => this.dispose(),
      undefined,
      this.disposables
    );

    // Initial update
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown') {
      this.updateFromDocument(editor.document);
    }
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    statusBarItem: vscode.StatusBarItem
  ) {
    if (MdQueryPanelProvider.instance) {
      MdQueryPanelProvider.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    MdQueryPanelProvider.instance = new MdQueryPanelProvider(context, statusBarItem);
  }

  private debouncedUpdate(doc: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration('mdquery');
    const delay = config.get<number>('debounceMs', 200);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.updateFromDocument(doc);
    }, delay);
  }

  private updateFromDocument(doc: vscode.TextDocument) {
    try {
      this.parsed = parseMarkdown(doc.getText());
    } catch {
      this.parsed = [];
    }
    this.sendFilterResult();
  }

  private sendFilterResult() {
    const result = filterItems(this.parsed, this.currentQuery);
    const totalCount = countItems(this.parsed);
    const metaKeys = getAllMetaKeys(this.parsed);
    const allTags = getAllTags(this.parsed);
    const metaValues = getAllMetaValues(this.parsed);

    // Convert Set to Array for serialization
    const ancestorLinesArray = Array.from(result.ancestorLines);

    this.panel.webview.postMessage({
      type: 'filterResult',
      items: result.items,
      error: result.error,
      totalCount: result.totalCount,
      matchedCount: result.matchedCount,
      ancestorLines: ancestorLinesArray,
      metaKeys,
      allTags,
      metaValues,
      query: this.currentQuery,
    });

    // Update status bar
    if (this.currentQuery) {
      this.statusBarItem.text = `$(search) ${result.matchedCount}/${result.totalCount}`;
    } else {
      this.statusBarItem.text = `$(search) MdQuery (${totalCount})`;
    }

    // Update editor decorations
    this.updateDecorations(result);
  }

  private updateDecorations(result: FilterResult) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      return;
    }
    if (!this.currentQuery) {
      editor.setDecorations(this.matchDecoration, []);
      editor.setDecorations(this.ancestorDecoration, []);
      return;
    }

    const matchRanges: vscode.Range[] = [];
    const ancestorRanges: vscode.Range[] = [];

    const collectLines = (items: ParsedItem[]) => {
      for (const item of items) {
        const line = item.line - 1; // 0-based
        if (line >= 0 && line < editor.document.lineCount) {
          if (result.ancestorLines.has(item.line)) {
            ancestorRanges.push(new vscode.Range(line, 0, line, 0));
          } else {
            matchRanges.push(new vscode.Range(line, 0, line, 0));
          }
        }
        if (item.children) {
          collectLines(item.children);
        }
      }
    };
    collectLines(result.items);

    editor.setDecorations(this.matchDecoration, matchRanges);
    editor.setDecorations(this.ancestorDecoration, ancestorRanges);
  }

  private onWebviewMessage(msg: { type: string; [key: string]: unknown }) {
    switch (msg.type) {
      case 'query':
        this.currentQuery = msg.expression as string;
        this.sendFilterResult();
        break;

      case 'goToLine': {
        const line = (msg.line as number) - 1;
        const editor = vscode.window.activeTextEditor;
        if (editor && line >= 0) {
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(line, 0, line, 0);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
        break;
      }

      case 'copyToClipboard':
        vscode.env.clipboard.writeText(msg.text as string);
        vscode.window.showInformationMessage('クリップボードにコピーしました');
        break;

      case 'ready':
        // Webview loaded — send initial data
        this.sendConfig();
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
          this.updateFromDocument(editor.document);
        }
        break;
    }
  }

  private sendConfig() {
    const config = vscode.workspace.getConfiguration('mdquery');
    const presets = config.get<Array<{ label: string; expr: string }>>('presetQueries', []);
    this.panel.webview.postMessage({
      type: 'config',
      presetQueries: presets,
    });
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <title>MdQuery</title>
  <style>
    :root {
      --spacing-xs: 4px;
      --spacing-sm: 8px;
      --spacing-md: 12px;
      --spacing-lg: 16px;
      --radius: 4px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ---- Header ---- */
    .header {
      padding: var(--spacing-sm) var(--spacing-lg);
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header-title {
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    .header-stats {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    .stat-match { color: var(--vscode-testing-iconPassed); }
    .stat-error { color: var(--vscode-errorForeground); }

    /* ---- Query bar ---- */
    .query-bar {
      padding: var(--spacing-sm) var(--spacing-lg);
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }
    .query-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    .query-input {
      flex: 1;
      padding: 5px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      border-radius: var(--radius);
      outline: none;
    }
    .query-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .query-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .error-bar {
      margin-top: var(--spacing-xs);
      padding: var(--spacing-xs) var(--spacing-sm);
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: var(--radius);
      font-size: 12px;
      color: var(--vscode-errorForeground);
      font-family: var(--vscode-editor-font-family);
      display: none;
    }
    /* ---- Saved filters ---- */
    .saved-filters {
      margin-top: var(--spacing-xs);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
    }
    .saved-filters:empty { display: none; }
    .saved-filters-icon { font-size: 12px; opacity: 0.6; margin-right: 2px; }
    .saved-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 4px 2px 8px;
      font-size: 11px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
      max-width: 200px;
    }
    .saved-chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .saved-chip.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .saved-chip .chip-label { overflow: hidden; text-overflow: ellipsis; }
    .saved-chip .chip-remove {
      padding: 0 2px;
      font-size: 12px;
      opacity: 0.6;
      cursor: pointer;
      border: none;
      background: none;
      color: inherit;
      border-radius: 50%;
      line-height: 1;
    }
    .saved-chip .chip-remove:hover { opacity: 1; background: rgba(255,255,255,0.15); }
    /* ---- Save filter inline form ---- */
    .save-filter-form {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .save-filter-form input {
      width: 120px;
      padding: 2px 6px;
      font-size: 11px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: var(--radius);
      outline: none;
      font-family: var(--vscode-editor-font-family);
    }
    .save-filter-form input:focus { border-color: var(--vscode-focusBorder); }

    /* ---- Suggest dropdown ---- */
    .suggest-wrap { position: relative; flex: 1; }
    .suggest-list {
      position: absolute;
      z-index: 50;
      left: 0; right: 0;
      margin-top: 4px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--radius);
      max-height: 240px;
      overflow: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .suggest-item {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 5px 10px;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family);
      border: none;
      background: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      text-align: left;
    }
    .suggest-item:hover, .suggest-item.selected {
      background: var(--vscode-list-hoverBackground);
    }
    .suggest-item .suggest-icon { opacity: 0.5; font-size: 11px; }

    /* ---- Copy JSON button ---- */
    .copy-json-btn {
      margin-left: auto;
      font-size: 11px;
      padding: 3px 8px;
      white-space: nowrap;
    }
    .btn {
      padding: 4px 10px;
      font-size: 12px;
      border: none;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }

    /* ---- Tabs ---- */
    .tabs {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-tab-inactiveBackground);
      flex-shrink: 0;
    }
    .tab-btn {
      padding: 6px 14px;
      font-size: 12px;
      border: none;
      background: transparent;
      color: var(--vscode-tab-inactiveForeground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
    }
    .tab-btn:hover {
      color: var(--vscode-tab-activeForeground);
      background: var(--vscode-tab-hoverBackground);
    }
    .tab-btn.active {
      color: var(--vscode-tab-activeForeground);
      border-bottom-color: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder));
      background: var(--vscode-tab-activeBackground);
    }
    .tab-content {
      flex: 1;
      overflow: auto;
      padding: var(--spacing-lg);
      display: none;
    }
    .tab-content.active { display: block; }

    /* ---- Markdown view ---- */
    .md-view { position: relative; }
    .md-pre {
      background: var(--vscode-textBlockQuote-background);
      padding: var(--spacing-md);
      border-radius: var(--radius);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .md-line { padding: 1px 4px; border-radius: 2px; cursor: pointer; display: block; }
    .md-line:hover { background: var(--vscode-list-hoverBackground); }
    .md-line.ancestor { opacity: 0.5; }
    .md-line.heading { font-weight: 700; margin-top: 6px; }
    .md-line .parent-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.6;
      margin-left: 8px;
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
    }

    /* ---- List view ---- */
    .list-view { display: flex; flex-direction: column; gap: var(--spacing-sm); }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--radius);
      padding: var(--spacing-md);
      background: var(--vscode-editor-background);
      cursor: pointer;
      transition: background 0.1s;
    }
    .card:hover { background: var(--vscode-list-hoverBackground); }
    .card.ancestor { border-style: dashed; opacity: 0.6; }
    .card.heading-card { background: color-mix(in srgb, var(--vscode-sideBar-background) 50%, transparent); border-left: 3px solid var(--vscode-textLink-foreground); }
    .heading-icon {
      width: 18px; height: 18px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700;
      color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
      border-radius: 3px;
    }
    .heading-icon-sm {
      width: 14px; height: 14px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700;
      color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
      border-radius: 2px;
    }
    .heading-level-label {
      color: var(--vscode-textLink-foreground);
      font-weight: 500;
    }
    .heading-badge {
      font-size: 10px;
      color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-sm);
    }
    .card-left { display: flex; align-items: flex-start; gap: var(--spacing-sm); flex: 1; min-width: 0; }
    .card-text { font-size: 13px; font-weight: 500; word-break: break-word; }
    .card-line { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .card-badges { display: flex; flex-wrap: wrap; gap: 4px; }
    .card-children {
      margin-left: 16px;
      margin-top: var(--spacing-sm);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
    }

    /* ---- Badges ---- */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 8px;
      white-space: nowrap;
    }
    .badge-tag {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .badge-meta {
      background: var(--vscode-textBlockQuote-background);
      color: var(--vscode-foreground);
    }
    .badge-meta .meta-key { font-weight: 600; }

    /* ---- Check icons ---- */
    .check-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    .check-icon.checked { color: var(--vscode-testing-iconPassed); }
    .check-icon.unchecked { color: var(--vscode-descriptionForeground); }

    /* ---- Table view ---- */
    .table-wrap { overflow-x: auto; border: 1px solid var(--vscode-panel-border); border-radius: var(--radius); }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .data-table th {
      text-align: left;
      padding: 6px 10px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600;
      white-space: nowrap;
    }
    .data-table th.mono { font-family: var(--vscode-editor-font-family); }
    .data-table td {
      padding: 4px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: top;
    }
    .data-table tr { cursor: pointer; }
    .data-table tr:hover { background: var(--vscode-list-hoverBackground); }
    .data-table tr.ancestor { opacity: 0.5; }
    .meta-cell {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .meta-cell .has-value {
      padding: 1px 6px;
      border-radius: var(--radius);
      background: var(--vscode-textBlockQuote-background);
    }
    .meta-cell .no-value { color: var(--vscode-descriptionForeground); opacity: 0.4; }

    /* ---- JSON view ---- */
    .json-view { position: relative; }
    .json-pre {
      background: var(--vscode-textBlockQuote-background);
      padding: var(--spacing-md);
      border-radius: var(--radius);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.5;
      overflow: auto;
    }

    /* ---- Empty state ---- */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
    .empty-icon { font-size: 32px; opacity: 0.3; margin-bottom: 8px; }

    /* ---- Waiting state ---- */
    .waiting {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      gap: 12px;
    }
    .waiting-icon { font-size: 48px; opacity: 0.3; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span class="codicon">&#x1F50D;</span>
      <span>MdQuery</span>
    </div>
    <div class="header-stats" id="stats"></div>
  </div>

  <div class="query-bar">
    <div class="query-row">
      <div class="suggest-wrap">
        <input type="text" class="query-input" id="queryInput" placeholder="#tag @key(val) key:val key>val … スペース=AND, OR=OR" autocomplete="off" spellcheck="false" />
      </div>
      <button class="btn" id="clearBtn" style="display:none;">クリア</button>
      <button class="btn" id="saveFilterBtn" style="display:none;" title="フィルタを保存">&#x1F516; 保存</button>
    </div>
    <div class="error-bar" id="errorBar"></div>
    <div class="saved-filters" id="savedFilters"></div>
  </div>

  <div class="tabs">
    <div class="tab-bar" id="tabBar">
      <button class="tab-btn active" data-tab="markdown">Markdown</button>
      <button class="tab-btn" data-tab="table">Data Table</button>
      <button class="btn copy-json-btn" id="copyJsonBtn">📋 JSON</button>
    </div>
    <div class="tab-content active" id="tab-markdown"></div>
    <div class="tab-content" id="tab-table"></div>
  </div>

  <div class="waiting" id="waitingState">
    <div class="waiting-icon">📄</div>
    <div>Markdown ファイルを開いてください</div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    MdQueryPanelProvider.instance = undefined;
    this.matchDecoration.dispose();
    this.ancestorDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    // Clear status bar
    this.statusBarItem.text = '$(search) MdQuery';
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
