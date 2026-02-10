/**
 * MdQuery Webview UI
 *
 * Communicates with extension host via postMessage.
 * Renders filter results in 4 tabs: Markdown / List / Table / JSON.
 */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface ParsedItem {
  text: string;
  rawLine: string;
  tags: string[];
  meta: Record<string, string>;
  checked: boolean | null;
  line: number;
  headingLevel?: number;
  children?: ParsedItem[];
}

interface FlatItem extends ParsedItem {
  depth: number;
  isAncestor: boolean;
  headingLevel?: number;
}

interface FilterResultMessage {
  type: 'filterResult';
  items: ParsedItem[];
  error: string | null;
  totalCount: number;
  matchedCount: number;
  ancestorLines: number[];
  metaKeys: string[];
  allTags: string[];
  query: string;
}

interface ConfigMessage {
  type: 'config';
  presetQueries: Array<{ label: string; expr: string }>;
}

type Message = FilterResultMessage | ConfigMessage;

// ----- Default preset queries -----
const DEFAULT_PRESETS: Array<{ label: string; expr: string }> = [
  { label: '#backend', expr: '#backend' },
  { label: '高優先度', expr: '@priority(high)' },
  { label: '#backend 高優先度', expr: '#backend @priority(high)' },
  { label: '#frontend OR #design', expr: '#frontend OR #design' },
  { label: '完了済み', expr: 'checked:true' },
  { label: '未完了 高優先度', expr: '!checked:true @priority(high)' },
  { label: 'due < today', expr: 'due<today' },
  { label: 'due < today+30', expr: 'due<today+30' },
  { label: '#infra (見出し)', expr: '#infra' },
];

// ----- State -----
const vscode = acquireVsCodeApi();
let currentItems: ParsedItem[] = [];
let currentAncestorLines = new Set<number>();
let currentMetaKeys: string[] = [];
let currentQuery = '';
let currentError: string | null = null;
let currentTotalCount = 0;
let currentMatchedCount = 0;
let activeTab = 'markdown';
let presets = DEFAULT_PRESETS;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let hasData = false;

// ----- DOM refs -----
const $ = (s: string) => document.querySelector(s)!;
const queryInput = $('#queryInput') as HTMLInputElement;
const clearBtn = $('#clearBtn') as HTMLButtonElement;
const errorBar = $('#errorBar') as HTMLDivElement;
const statsEl = $('#stats') as HTMLDivElement;
const presetsEl = $('#presets') as HTMLDivElement;
const tabBar = $('#tabBar') as HTMLDivElement;
const waitingState = $('#waitingState') as HTMLDivElement;

const tabContents: Record<string, HTMLDivElement> = {
  markdown: $('#tab-markdown') as HTMLDivElement,
  list: $('#tab-list') as HTMLDivElement,
  table: $('#tab-table') as HTMLDivElement,
  json: $('#tab-json') as HTMLDivElement,
};

// ----- Init -----
function init() {
  // Query input
  queryInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentQuery = queryInput.value;
      updateClearBtn();
      updatePresetHighlight();
      vscode.postMessage({ type: 'query', expression: currentQuery });
    }, 200);
  });

  clearBtn.addEventListener('click', () => {
    queryInput.value = '';
    currentQuery = '';
    updateClearBtn();
    updatePresetHighlight();
    vscode.postMessage({ type: 'query', expression: '' });
  });

  // Tab switching
  tabBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLElement;
    if (!btn) return;
    const tab = btn.dataset.tab!;
    setActiveTab(tab);
  });

  // Render presets
  renderPresets();

  // Listen for messages from extension host
  window.addEventListener('message', (e) => {
    const msg = e.data as Message;
    switch (msg.type) {
      case 'filterResult':
        handleFilterResult(msg);
        break;
      case 'config':
        if (msg.presetQueries && msg.presetQueries.length > 0) {
          presets = msg.presetQueries;
          renderPresets();
        }
        break;
    }
  });

  // Tell extension host we're ready
  vscode.postMessage({ type: 'ready' });
}

// ----- Tab management -----
function setActiveTab(tab: string) {
  activeTab = tab;
  tabBar.querySelectorAll('.tab-btn').forEach((btn) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });
  for (const [key, el] of Object.entries(tabContents)) {
    el.classList.toggle('active', key === tab);
  }
}

// ----- Presets -----
function renderPresets() {
  presetsEl.innerHTML = '';
  for (const p of presets) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = p.label;
    btn.dataset.expr = p.expr;
    btn.addEventListener('click', () => {
      queryInput.value = p.expr;
      currentQuery = p.expr;
      updateClearBtn();
      updatePresetHighlight();
      vscode.postMessage({ type: 'query', expression: currentQuery });
    });
    presetsEl.appendChild(btn);
  }
}

function updatePresetHighlight() {
  presetsEl.querySelectorAll('.preset-btn').forEach((btn) => {
    const el = btn as HTMLElement;
    el.classList.toggle('active', el.dataset.expr === currentQuery);
  });
}

function updateClearBtn() {
  clearBtn.style.display = currentQuery ? '' : 'none';
}

// ----- Handle filter result -----
function handleFilterResult(msg: FilterResultMessage) {
  hasData = true;
  currentItems = msg.items;
  currentAncestorLines = new Set(msg.ancestorLines);
  currentMetaKeys = msg.metaKeys;
  currentError = msg.error;
  currentTotalCount = msg.totalCount;
  currentMatchedCount = msg.matchedCount;

  // Hide waiting state, show tabs
  waitingState.style.display = 'none';
  document.querySelector('.tabs')!.removeAttribute('style');

  renderStats();
  renderError();
  renderAll();
}

// ----- Render helpers -----
function renderStats() {
  let html = `<span>${currentTotalCount} items</span>`;
  if (currentQuery) {
    if (currentError) {
      html += `<span class="stat-error">⚠ Error</span>`;
    } else {
      html += `<span class="stat-match">✓ ${currentMatchedCount}/${currentTotalCount} matched</span>`;
    }
  }
  statsEl.innerHTML = html;
}

function renderError() {
  if (currentError) {
    errorBar.style.display = 'block';
    errorBar.textContent = currentError;
  } else {
    errorBar.style.display = 'none';
  }
}

function renderAll() {
  renderMarkdownTab();
  renderListTab();
  renderTableTab();
  renderJsonTab();
}

// ----- Click-to-go-to-line -----
function goToLine(line: number) {
  vscode.postMessage({ type: 'goToLine', line });
}

function copyText(text: string) {
  vscode.postMessage({ type: 'copyToClipboard', text });
}

// ----- Check icon -----
function checkIconHtml(checked: boolean | null): string {
  if (checked === null) return '';
  if (checked) return `<span class="check-icon checked" title="completed">☑</span>`;
  return `<span class="check-icon unchecked" title="unchecked">☐</span>`;
}

// ----- Badges -----
function tagBadgesHtml(tags: string[]): string {
  return tags.map(t => `<span class="badge badge-tag">#${esc(t)}</span>`).join('');
}

function metaBadgesHtml(meta: Record<string, string>): string {
  return Object.entries(meta).map(
    ([k, v]) => `<span class="badge badge-meta"><span class="meta-key">${esc(k)}</span>:${esc(v)}</span>`
  ).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== MARKDOWN TAB =====
function collectRawLines(items: ParsedItem[]): string[] {
  const lines: string[] = [];
  for (const it of items) {
    lines.push(it.rawLine);
    if (it.children) lines.push(...collectRawLines(it.children));
  }
  return lines;
}

function mdLinesHtml(items: ParsedItem[]): string {
  let html = '';
  for (const it of items) {
    const isAnc = currentAncestorLines.has(it.line);
    const isHeading = !!it.headingLevel;
    html += `<span class="md-line${isAnc ? ' ancestor' : ''}${isHeading ? ' heading' : ''}" data-line="${it.line}">`;
    html += esc(it.rawLine);
    if (isAnc) html += `<span class="parent-label">← parent</span>`;
    html += `</span>\n`;
    if (it.children) html += mdLinesHtml(it.children);
  }
  return html;
}

function renderMarkdownTab() {
  const el = tabContents.markdown;
  if (currentItems.length === 0) {
    el.innerHTML = emptyHtml('📄');
    return;
  }
  const rawLines = collectRawLines(currentItems);
  el.innerHTML = `
    <div class="md-view">
      <button class="btn copy-btn" id="mdCopyBtn">コピー</button>
      <pre class="md-pre">${mdLinesHtml(currentItems)}</pre>
    </div>`;

  el.querySelector('#mdCopyBtn')?.addEventListener('click', () => {
    copyText(rawLines.join('\n'));
  });
  el.querySelectorAll('.md-line').forEach(line => {
    line.addEventListener('click', () => {
      const l = parseInt((line as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
  });
}

// ===== LIST TAB =====
function headingTextHtml(level: number, text: string): string {
  const sizes = ['font-size:18px;font-weight:700', 'font-size:16px;font-weight:700', 'font-size:14px;font-weight:600', 'font-size:13px;font-weight:600'];
  const style = sizes[level - 1] || sizes[3];
  return `<span style="${style}">${esc(text)}</span>`;
}

function cardsHtml(items: ParsedItem[], depth: number): string {
  let html = '';
  for (const it of items) {
    const isAnc = currentAncestorLines.has(it.line);
    const isHeading = !!it.headingLevel;
    html += `<div class="card${isAnc ? ' ancestor' : ''}${isHeading ? ' heading-card' : ''}" data-line="${it.line}">`;
    html += `<div class="card-header">`;
    html += `<div class="card-left">`;
    if (isHeading) {
      html += `<span class="heading-icon" title="H${it.headingLevel}">H</span>`;
    } else {
      html += checkIconHtml(it.checked);
      if (depth > 0) html += `<span style="color:var(--vscode-descriptionForeground);font-size:12px">›</span>`;
    }
    html += `<div>`;
    html += `<div class="card-text">`;
    if (isHeading) {
      html += headingTextHtml(it.headingLevel!, it.text);
    } else {
      html += esc(it.text);
    }
    if (isAnc) html += ` <span style="font-size:10px;opacity:0.6;background:var(--vscode-textBlockQuote-background);padding:1px 4px;border-radius:3px">parent</span>`;
    html += `</div>`;
    html += `<div class="card-line">`;
    if (isHeading) html += `<span class="heading-level-label">H${it.headingLevel} · </span>`;
    html += `Line ${it.line}</div>`;
    html += `</div></div>`;
    if (it.tags.length > 0 || Object.keys(it.meta).length > 0) {
      html += `<div class="card-badges">${tagBadgesHtml(it.tags)}${metaBadgesHtml(it.meta)}</div>`;
    }
    html += `</div>`; // card-header
    if (it.children && it.children.length > 0) {
      html += `<div class="card-children">${cardsHtml(it.children, depth + 1)}</div>`;
    }
    html += `</div>`; // card
  }
  return html;
}

function renderListTab() {
  const el = tabContents.list;
  if (currentItems.length === 0) {
    el.innerHTML = emptyHtml('📝');
    return;
  }
  el.innerHTML = `<div class="list-view">${cardsHtml(currentItems, 0)}</div>`;
  el.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't trigger for child cards
      if ((e.target as HTMLElement).closest('.card') !== card) return;
      const l = parseInt((card as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
  });
}

// ===== TABLE TAB =====
function flattenItems(items: ParsedItem[], depth = 0, ancestorLines?: Set<number>): FlatItem[] {
  const out: FlatItem[] = [];
  for (const it of items) {
    out.push({
      ...it,
      depth,
      isAncestor: ancestorLines ? ancestorLines.has(it.line) : false,
    });
    if (it.children) {
      out.push(...flattenItems(it.children, depth + 1, ancestorLines));
    }
  }
  return out;
}

function renderTableTab() {
  const el = tabContents.table;
  const flat = flattenItems(currentItems, 0, currentAncestorLines);
  if (flat.length === 0) {
    el.innerHTML = emptyHtml('📊');
    return;
  }

  let html = `<div class="table-wrap"><table class="data-table">`;
  html += `<thead><tr><th>☐</th><th>Line</th><th>Text</th><th>Tags</th>`;
  for (const k of currentMetaKeys) {
    html += `<th class="mono">${esc(k)}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const it of flat) {
    html += `<tr class="${it.isAncestor ? 'ancestor' : ''}" data-line="${it.line}">`;
    html += `<td>${checkIconHtml(it.checked)}</td>`;
    html += `<td style="color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums">${it.line}</td>`;
    html += `<td style="max-width:260px">`;
    html += `<span style="padding-left:${it.depth * 14}px;display:inline-flex;align-items:center;gap:4px">`;
    if (it.headingLevel) {
      html += `<span class="heading-icon-sm">H</span>`;
      html += `<span style="font-weight:700">${esc(it.text)}</span>`;
      html += `<span class="heading-badge">H${it.headingLevel}</span>`;
    } else {
      if (it.depth > 0) html += `<span style="color:var(--vscode-descriptionForeground);font-size:11px">›</span>`;
      html += esc(it.text);
    }
    if (it.isAncestor) html += ` <span style="font-size:10px;opacity:0.6;background:var(--vscode-textBlockQuote-background);padding:1px 4px;border-radius:3px">parent</span>`;
    html += `</span></td>`;
    html += `<td>${tagBadgesHtml(it.tags)}</td>`;
    for (const k of currentMetaKeys) {
      html += `<td class="meta-cell">`;
      if (it.meta[k]) {
        html += `<span class="has-value">${esc(it.meta[k])}</span>`;
      } else {
        html += `<span class="no-value">—</span>`;
      }
      html += `</td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  el.innerHTML = html;

  el.querySelectorAll('tr[data-line]').forEach(row => {
    row.addEventListener('click', () => {
      const l = parseInt((row as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
  });
}

// ===== JSON TAB =====
function renderJsonTab() {
  const el = tabContents.json;
  const json = JSON.stringify(currentItems, null, 2);
  el.innerHTML = `
    <div class="json-view">
      <button class="btn copy-btn" id="jsonCopyBtn">コピー</button>
      <pre class="json-pre">${esc(json)}</pre>
    </div>`;
  el.querySelector('#jsonCopyBtn')?.addEventListener('click', () => {
    copyText(json);
  });
}

// ===== Empty state =====
function emptyHtml(icon: string): string {
  return `<div class="empty"><div class="empty-icon">${icon}</div><div>マッチする項目がありません</div></div>`;
}

// ----- Start -----
init();
