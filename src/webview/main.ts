/**
 * MdQuery Webview UI
 *
 * Communicates with extension host via postMessage.
 * Renders filter results in 2 tabs: Markdown / Data Table.
 * JSON copy is a button in the tab bar.
 * Saved filters replace presets. Query input has suggest dropdown.
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
}

interface SavedFilter {
  id: string;
  label: string;
  expr: string;
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
  metaValues: Record<string, string[]>;
  query: string;
}

interface ConfigMessage {
  type: 'config';
  presetQueries: Array<{ label: string; expr: string }>;
}

type Message = FilterResultMessage | ConfigMessage;

// ===== State =====
const vscode = acquireVsCodeApi();
let currentItems: ParsedItem[] = [];
let currentAncestorLines = new Set<number>();
let currentMetaKeys: string[] = [];
let currentAllTags: string[] = [];
let currentMetaValues: Record<string, string[]> = {};
let currentQuery = '';
let currentError: string | null = null;
let currentTotalCount = 0;
let currentMatchedCount = 0;
let activeTab = 'markdown';
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let hasData = false;
let jsonCopied = false;
let jsonCopyTimer: ReturnType<typeof setTimeout> | undefined;

// Saved filters (persisted via vscode state)
let savedFilters: SavedFilter[] = [];

// Suggest state
let suggestOpen = false;
let suggestItems: SuggestItem[] = [];
let suggestSelectedIdx = 0;
let suppressSuggestOnFocus = false;

interface SuggestItem {
  label: string;
  insert: string;
  kind: 'tag' | 'meta-key' | 'meta-value' | 'operator' | 'checked';
}

// ===== DOM refs =====
const $ = (s: string) => document.querySelector(s)!;
const queryInput = $('#queryInput') as HTMLInputElement;
const clearBtn = $('#clearBtn') as HTMLButtonElement;
const saveFilterBtn = $('#saveFilterBtn') as HTMLButtonElement;
const errorBar = $('#errorBar') as HTMLDivElement;
const statsEl = $('#stats') as HTMLDivElement;
const savedFiltersEl = $('#savedFilters') as HTMLDivElement;
const tabBar = $('#tabBar') as HTMLDivElement;
const waitingState = $('#waitingState') as HTMLDivElement;
const copyJsonBtn = $('#copyJsonBtn') as HTMLButtonElement;

const tabContents: Record<string, HTMLDivElement> = {
  markdown: $('#tab-markdown') as HTMLDivElement,
  table: $('#tab-table') as HTMLDivElement,
};

// ===== Init =====
function init() {
  // Load saved state
  const state = vscode.getState() as { savedFilters?: SavedFilter[] } | null;
  if (state?.savedFilters) savedFilters = state.savedFilters;

  // Query input with debounce
  queryInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentQuery = queryInput.value;
      updateButtons();
      updateSavedFilterHighlight();
      vscode.postMessage({ type: 'query', expression: currentQuery });
    }, 200);
    // Update suggest
    suggestOpen = true;
    updateSuggest();
  });

  queryInput.addEventListener('focus', () => {
    if (suppressSuggestOnFocus) { suppressSuggestOnFocus = false; return; }
    suggestOpen = true;
    updateSuggest();
  });
  queryInput.addEventListener('blur', () => {
    setTimeout(() => { suggestOpen = false; renderSuggest(); }, 150);
  });
  queryInput.addEventListener('click', () => { updateSuggest(); });
  queryInput.addEventListener('keydown', handleSuggestKeydown);

  clearBtn.addEventListener('click', () => {
    queryInput.value = '';
    currentQuery = '';
    updateButtons();
    updateSavedFilterHighlight();
    vscode.postMessage({ type: 'query', expression: '' });
  });

  saveFilterBtn.addEventListener('click', showSaveForm);

  // JSON copy button
  copyJsonBtn.addEventListener('click', () => {
    const json = JSON.stringify(currentItems, null, 2);
    copyText(json);
    jsonCopied = true;
    copyJsonBtn.textContent = '✅ コピー済み';
    if (jsonCopyTimer) clearTimeout(jsonCopyTimer);
    jsonCopyTimer = setTimeout(() => {
      jsonCopied = false;
      copyJsonBtn.textContent = '📋 JSON';
    }, 2000);
  });

  // Tab switching
  tabBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLElement;
    if (!btn) return;
    const tab = btn.dataset.tab!;
    setActiveTab(tab);
  });

  renderSavedFilters();

  // Listen for messages from extension host
  window.addEventListener('message', (e) => {
    const msg = e.data as Message;
    switch (msg.type) {
      case 'filterResult':
        handleFilterResult(msg);
        break;
      case 'config':
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
}

// ===== Tab management =====
function setActiveTab(tab: string) {
  activeTab = tab;
  tabBar.querySelectorAll('.tab-btn').forEach((btn) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });
  for (const [key, el] of Object.entries(tabContents)) {
    el.classList.toggle('active', key === tab);
  }
}

// ===== Buttons =====
function updateButtons() {
  clearBtn.style.display = currentQuery ? '' : 'none';
  saveFilterBtn.style.display = currentQuery.trim() ? '' : 'none';
}

// ===== Saved filters =====
function persistState() {
  vscode.setState({ savedFilters });
}

function renderSavedFilters() {
  savedFiltersEl.innerHTML = '';
  if (savedFilters.length === 0) return;
  savedFiltersEl.innerHTML = '<span class="saved-filters-icon">🔖</span>';
  for (const f of savedFilters) {
    const chip = document.createElement('span');
    chip.className = `saved-chip${currentQuery === f.expr ? ' active' : ''}`;
    chip.title = f.expr;
    chip.innerHTML = `<span class="chip-label">${esc(f.label)}</span><button class="chip-remove" data-id="${f.id}" title="削除">×</button>`;
    chip.querySelector('.chip-label')!.addEventListener('click', () => {
      queryInput.value = f.expr;
      currentQuery = f.expr;
      updateButtons();
      updateSavedFilterHighlight();
      vscode.postMessage({ type: 'query', expression: currentQuery });
    });
    chip.querySelector('.chip-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      savedFilters = savedFilters.filter(sf => sf.id !== f.id);
      persistState();
      renderSavedFilters();
    });
    savedFiltersEl.appendChild(chip);
  }
}

function updateSavedFilterHighlight() {
  savedFiltersEl.querySelectorAll('.saved-chip').forEach((chip) => {
    const el = chip as HTMLElement;
    el.classList.toggle('active', el.title === currentQuery);
  });
}

function showSaveForm() {
  const defaultLabel = currentQuery.length > 20 ? currentQuery.slice(0, 20) + '…' : currentQuery;
  // Replace save button with inline form
  const form = document.createElement('span');
  form.className = 'save-filter-form';
  form.innerHTML = `<input type="text" value="${esc(defaultLabel)}" placeholder="ラベル名" /><button class="btn">✓</button><button class="btn">×</button>`;
  saveFilterBtn.style.display = 'none';
  saveFilterBtn.parentElement!.insertBefore(form, saveFilterBtn.nextSibling);
  const input = form.querySelector('input')!;
  input.focus();
  input.select();
  const commit = () => {
    const label = input.value.trim();
    if (label) {
      savedFilters.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label, expr: currentQuery });
      persistState();
      renderSavedFilters();
    }
    form.remove();
    updateButtons();
  };
  const cancel = () => { form.remove(); updateButtons(); };
  form.querySelectorAll('button')[0].addEventListener('click', commit);
  form.querySelectorAll('button')[1].addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  });
}

// ===== Suggest =====
function getTokenAtCursor(): { token: string; start: number; end: number } {
  const val = queryInput.value;
  const cursor = queryInput.selectionStart ?? val.length;
  let start = cursor;
  while (start > 0 && val[start - 1] !== ' ') start--;
  let end = cursor;
  while (end < val.length && val[end] !== ' ') end++;
  return { token: val.slice(start, end), start, end };
}

function buildSuggestions(tok: string): SuggestItem[] {
  const items: SuggestItem[] = [];
  const isNeg = tok.startsWith('!');
  const prefix = isNeg ? '!' : '';
  const body = isNeg ? tok.slice(1) : tok;

  if (body.startsWith('#')) {
    const partial = body.slice(1).toLowerCase();
    for (const t of currentAllTags) {
      if (!partial || t.toLowerCase().includes(partial))
        items.push({ label: `${prefix}#${t}`, insert: `${prefix}#${t}`, kind: 'tag' });
    }
    return items;
  }

  if (body.startsWith('@')) {
    const inner = body.slice(1);
    const pi = inner.indexOf('(');
    if (pi === -1) {
      const partial = inner.toLowerCase();
      for (const k of currentMetaKeys) {
        if (!partial || k.toLowerCase().includes(partial))
          items.push({ label: `${prefix}@${k}(…)`, insert: `${prefix}@${k}()`, kind: 'meta-key' });
      }
    } else {
      const key = inner.slice(0, pi);
      const valPart = inner.slice(pi + 1).replace(/\)$/, '').toLowerCase();
      for (const v of (currentMetaValues[key] || [])) {
        if (!valPart || v.toLowerCase().includes(valPart))
          items.push({ label: `${prefix}@${key}(${v})`, insert: `${prefix}@${key}(${v})`, kind: 'meta-value' });
      }
    }
    return items;
  }

  const opM = body.match(/^([\w.-]+)([:<>])(.*)$/);
  if (opM) {
    const [, key, op, valPart] = opM;
    if (key === 'checked') {
      for (const v of ['true', 'false']) {
        if (!valPart || v.startsWith(valPart))
          items.push({ label: `${prefix}checked:${v}`, insert: `${prefix}checked:${v}`, kind: 'checked' });
      }
      return items;
    }
    const partial = valPart.toLowerCase();
    for (const v of (currentMetaValues[key] || [])) {
      if (!partial || v.toLowerCase().includes(partial))
        items.push({ label: `${prefix}${key}${op}${v}`, insert: `${prefix}${key}${op}${v}`, kind: 'meta-value' });
    }
    if (op === '>' || op === '<') {
      for (const d of ['today', 'today+7', 'today+30', 'today-7', 'today-30']) {
        if (!partial || d.toLowerCase().includes(partial))
          items.push({ label: `${prefix}${key}${op}${d}`, insert: `${prefix}${key}${op}${d}`, kind: 'operator' });
      }
    }
    return items;
  }

  if (!body) {
    items.push({ label: '#… (タグ)', insert: '#', kind: 'tag' });
    items.push({ label: '@… (メタ)', insert: '@', kind: 'meta-key' });
    items.push({ label: 'checked:…', insert: 'checked:', kind: 'checked' });
    for (const k of currentMetaKeys.slice(0, 5))
      items.push({ label: `${k}:…`, insert: `${k}:`, kind: 'meta-key' });
    return items;
  }

  const partial = body.toLowerCase();
  for (const t of currentAllTags) {
    if (t.toLowerCase().includes(partial))
      items.push({ label: `${prefix}#${t}`, insert: `${prefix}#${t}`, kind: 'tag' });
  }
  for (const k of currentMetaKeys) {
    if (k.toLowerCase().includes(partial)) {
      items.push({ label: `${prefix}${k}:…`, insert: `${prefix}${k}:`, kind: 'meta-key' });
      items.push({ label: `${prefix}@${k}(…)`, insert: `${prefix}@${k}()`, kind: 'meta-key' });
    }
  }
  return items;
}

function updateSuggest() {
  if (!suggestOpen) { renderSuggest(); return; }
  const ctx = getTokenAtCursor();
  suggestItems = buildSuggestions(ctx.token);
  suggestSelectedIdx = 0;
  renderSuggest();
}

function renderSuggest() {
  let list = document.getElementById('suggestList');
  if (!suggestOpen || suggestItems.length === 0) {
    list?.remove();
    return;
  }
  if (!list) {
    list = document.createElement('div');
    list.id = 'suggestList';
    list.className = 'suggest-list';
    queryInput.parentElement!.appendChild(list);
  }
  const kindIcons: Record<string, string> = { tag: '#', 'meta-key': '@', 'meta-value': '=', operator: '∴', checked: '☑' };
  list.innerHTML = suggestItems.map((item, i) =>
    `<button class="suggest-item${i === suggestSelectedIdx ? ' selected' : ''}" data-idx="${i}"><span class="suggest-icon">${kindIcons[item.kind] || '?'}</span>${esc(item.label)}</button>`
  ).join('');
  list.querySelectorAll('.suggest-item').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt((btn as HTMLElement).dataset.idx || '0');
      applySuggestion(suggestItems[idx]);
    });
  });
}

function applySuggestion(item: SuggestItem) {
  const ctx = getTokenAtCursor();
  const val = queryInput.value;
  const before = val.slice(0, ctx.start);
  const after = val.slice(ctx.end);
  const parenInsert = item.insert.endsWith('()');
  const newVal = before + item.insert + after;
  queryInput.value = newVal;
  currentQuery = newVal;
  suggestOpen = false;
  renderSuggest();
  updateButtons();
  updateSavedFilterHighlight();
  vscode.postMessage({ type: 'query', expression: currentQuery });
  suppressSuggestOnFocus = true;
  requestAnimationFrame(() => {
    queryInput.focus();
    const pos = parenInsert ? before.length + item.insert.length - 1 : before.length + item.insert.length;
    queryInput.setSelectionRange(pos, pos);
  });
}

function handleSuggestKeydown(e: KeyboardEvent) {
  if (!suggestOpen || suggestItems.length === 0) return;
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); suggestSelectedIdx = (suggestSelectedIdx + 1) % suggestItems.length; renderSuggest(); break;
    case 'ArrowUp': e.preventDefault(); suggestSelectedIdx = (suggestSelectedIdx - 1 + suggestItems.length) % suggestItems.length; renderSuggest(); break;
    case 'Tab': case 'Enter': e.preventDefault(); applySuggestion(suggestItems[suggestSelectedIdx]); break;
    case 'Escape': e.preventDefault(); suggestOpen = false; renderSuggest(); break;
  }
}

// ===== Handle filter result =====
function handleFilterResult(msg: FilterResultMessage) {
  hasData = true;
  currentItems = msg.items;
  currentAncestorLines = new Set(msg.ancestorLines);
  currentMetaKeys = msg.metaKeys;
  currentAllTags = msg.allTags;
  currentMetaValues = msg.metaValues || {};
  currentError = msg.error;
  currentTotalCount = msg.totalCount;
  currentMatchedCount = msg.matchedCount;

  waitingState.style.display = 'none';
  document.querySelector('.tabs')!.removeAttribute('style');

  renderStats();
  renderError();
  renderAll();
}

// ===== Render helpers =====
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
  errorBar.style.display = currentError ? 'block' : 'none';
  if (currentError) errorBar.textContent = currentError;
}

function renderAll() {
  renderMarkdownTab();
  renderTableTab();
}

function goToLine(line: number) { vscode.postMessage({ type: 'goToLine', line }); }
function copyText(text: string) { vscode.postMessage({ type: 'copyToClipboard', text }); }

function checkIconHtml(checked: boolean | null): string {
  if (checked === null) return '';
  return checked
    ? `<span class="check-icon checked">☑</span>`
    : `<span class="check-icon unchecked">☐</span>`;
}

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
    const isH = !!it.headingLevel;
    html += `<span class="md-line${isAnc ? ' ancestor' : ''}${isH ? ' heading' : ''}" data-line="${it.line}">${esc(it.rawLine)}`;
    if (isAnc) html += `<span class="parent-label">← parent</span>`;
    html += `</span>\n`;
    if (it.children) html += mdLinesHtml(it.children);
  }
  return html;
}

function renderMarkdownTab() {
  const el = tabContents.markdown;
  if (currentItems.length === 0) { el.innerHTML = emptyHtml('📄'); return; }
  const rawLines = collectRawLines(currentItems);
  el.innerHTML = `<div class="md-view"><button class="btn copy-btn" id="mdCopyBtn">コピー</button><pre class="md-pre">${mdLinesHtml(currentItems)}</pre></div>`;
  el.querySelector('#mdCopyBtn')?.addEventListener('click', () => copyText(rawLines.join('\n')));
  el.querySelectorAll('.md-line').forEach(line => {
    line.addEventListener('click', () => {
      const l = parseInt((line as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
  });
}

// ===== TABLE TAB =====
function flattenItems(items: ParsedItem[], depth = 0, ancestorLines?: Set<number>): FlatItem[] {
  const out: FlatItem[] = [];
  for (const it of items) {
    out.push({ ...it, depth, isAncestor: ancestorLines ? ancestorLines.has(it.line) : false });
    if (it.children) out.push(...flattenItems(it.children, depth + 1, ancestorLines));
  }
  return out;
}

function renderTableTab() {
  const el = tabContents.table;
  const flat = flattenItems(currentItems, 0, currentAncestorLines);
  if (flat.length === 0) { el.innerHTML = emptyHtml('📊'); return; }

  let html = `<div class="table-wrap"><table class="data-table"><thead><tr><th>☐</th><th>Line</th><th>Text</th><th>Tags</th>`;
  for (const k of currentMetaKeys) html += `<th class="mono">${esc(k)}</th>`;
  html += `</tr></thead><tbody>`;

  for (const it of flat) {
    html += `<tr class="${it.isAncestor ? 'ancestor' : ''}" data-line="${it.line}">`;
    html += `<td>${checkIconHtml(it.checked)}</td>`;
    html += `<td style="color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums">${it.line}</td>`;
    html += `<td style="max-width:260px"><span style="padding-left:${it.depth * 14}px;display:inline-flex;align-items:center;gap:4px">`;
    if (it.headingLevel) {
      html += `<span class="heading-icon-sm">H</span><span style="font-weight:700">${esc(it.text)}</span><span class="heading-badge">H${it.headingLevel}</span>`;
    } else {
      if (it.depth > 0) html += `<span style="color:var(--vscode-descriptionForeground);font-size:11px">›</span>`;
      html += esc(it.text);
    }
    if (it.isAncestor) html += ` <span style="font-size:10px;opacity:0.6;background:var(--vscode-textBlockQuote-background);padding:1px 4px;border-radius:3px">parent</span>`;
    html += `</span></td><td>${tagBadgesHtml(it.tags)}</td>`;
    for (const k of currentMetaKeys) {
      html += `<td class="meta-cell">${it.meta[k] ? `<span class="has-value">${esc(it.meta[k])}</span>` : '<span class="no-value">—</span>'}</td>`;
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

function emptyHtml(icon: string): string {
  return `<div class="empty"><div class="empty-icon">${icon}</div><div>マッチする項目がありません</div></div>`;
}

init();
