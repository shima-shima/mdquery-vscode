/**
 * MdQuery Webview UI
 *
 * Communicates with extension host via postMessage.
 * Renders filter results in 2 tabs: Markdown / Data Table.
 * JSON copy is a button in the tab bar.
 * Saved filters replace presets. Query input has suggest dropdown.
 */

import {
  esc,
  collectRawLines,
  mdLinesHtml,
  renderTableHtml,
  renderCalendarHtml,
  collectDateMap,
  findEarliestMonth,
  emptyHtml,
} from '../lib/renderers';
import {
  type SuggestItem,
  getTokenAtCursor,
  buildSuggestions,
} from '../lib/suggest';

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

interface LoadClipsMessage {
  type: 'loadClips';
  clips: SavedFilter[];
}

type Message = FilterResultMessage | ConfigMessage | LoadClipsMessage;

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

// Calendar state
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;
let calendarInitialized = false;

// Saved filters (persisted via vscode state)
let savedFilters: SavedFilter[] = [];

// Suggest state
let suggestOpen = false;
let suggestItems: SuggestItem[] = [];
let suggestSelectedIdx = 0;
let suppressSuggestOnFocus = false;

// ===== Calendar tooltip =====
let calTooltip: HTMLDivElement | null = null;

function getCalTooltip(): HTMLDivElement {
  if (!calTooltip) {
    calTooltip = document.createElement('div');
    calTooltip.className = 'cal-tooltip';
    document.body.appendChild(calTooltip);
  }
  return calTooltip;
}

function showCalTooltip(target: HTMLElement) {
  const text = target.dataset.tooltip;
  if (!text) return;
  const tip = getCalTooltip();
  tip.classList.remove('visible');
  tip.textContent = text;

  // Measure while invisible (opacity 0, but display block)
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const rect = target.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
  if (left < 8) left = 8;
  if (top + th > window.innerHeight - 8) top = rect.top - th - 4;

  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.classList.add('visible');
}

function hideCalTooltip() {
  if (calTooltip) calTooltip.classList.remove('visible');
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
  calendar: $('#tab-calendar') as HTMLDivElement,
};

// ===== Init =====
function init() {
  // Clips are loaded from front matter via 'loadClips' message from extension host.
  // Also restore from webview state as a fallback for panel re-reveal.
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
      case 'loadClips':
        savedFilters = msg.clips || [];
        vscode.setState({ savedFilters });
        renderSavedFilters();
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
  // Persist to front matter via extension host
  vscode.postMessage({ type: 'saveClips', clips: savedFilters });
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
function updateSuggest() {
  if (!suggestOpen) { renderSuggest(); return; }
  const val = queryInput.value;
  const cursor = queryInput.selectionStart ?? val.length;
  const ctx = getTokenAtCursor(val, cursor);
  suggestItems = buildSuggestions(ctx.token, currentAllTags, currentMetaKeys, currentMetaValues);
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
  const val = queryInput.value;
  const cursor = queryInput.selectionStart ?? val.length;
  const ctx = getTokenAtCursor(val, cursor);
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

  // Reset calendar to earliest month on each new result
  calendarInitialized = false;

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
  renderCalendarTab();
}

function goToLine(line: number) { vscode.postMessage({ type: 'goToLine', line }); }
function copyText(text: string) { vscode.postMessage({ type: 'copyToClipboard', text }); }

// ===== MARKDOWN TAB =====
function renderMarkdownTab() {
  const el = tabContents.markdown;
  if (currentItems.length === 0) { el.innerHTML = emptyHtml('📄'); return; }
  const rawLines = collectRawLines(currentItems);
  el.innerHTML = `<div class="md-view"><button class="btn copy-btn" id="mdCopyBtn">コピー</button><pre class="md-pre">${mdLinesHtml(currentItems, currentAncestorLines)}</pre></div>`;
  el.querySelector('#mdCopyBtn')?.addEventListener('click', () => copyText(rawLines.join('\n')));
  el.querySelectorAll('.md-line').forEach(line => {
    line.addEventListener('click', () => {
      const l = parseInt((line as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
  });
}

// ===== CALENDAR TAB =====
function renderCalendarTab() {
  const el = tabContents.calendar;

  // Determine initial month: earliest month with items (only on first data load or query change)
  if (!calendarInitialized) {
    const dateMap = collectDateMap(currentItems);
    const earliest = findEarliestMonth(dateMap);
    if (earliest) {
      calendarYear = earliest.year;
      calendarMonth = earliest.month;
    } else {
      const now = new Date();
      calendarYear = now.getFullYear();
      calendarMonth = now.getMonth() + 1;
    }
    calendarInitialized = true;
  }

  el.innerHTML = renderCalendarHtml(currentItems, currentAncestorLines, calendarYear, calendarMonth);
  bindCalendarEvents(el);
}

function bindCalendarEvents(el: HTMLDivElement) {
  // Month navigation
  el.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = (btn as HTMLElement).dataset.calNav;
      if (dir === 'prev') {
        calendarMonth--;
        if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
      } else {
        calendarMonth++;
        if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
      }
      renderCalendarTab();
    });
  });

  // Click item to go to line, tooltip on hover
  el.querySelectorAll('.cal-item[data-line]').forEach(item => {
    item.addEventListener('click', () => {
      const l = parseInt((item as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
    item.addEventListener('mouseenter', () => showCalTooltip(item as HTMLElement));
    item.addEventListener('mouseleave', hideCalTooltip);
  });
}

// ===== TABLE TAB =====
function renderTableTab() {
  const el = tabContents.table;
  el.innerHTML = renderTableHtml(currentItems, currentMetaKeys, currentAncestorLines);
  el.querySelectorAll('tr[data-line]').forEach(row => {
    row.addEventListener('click', () => {
      const l = parseInt((row as HTMLElement).dataset.line || '0');
      if (l > 0) goToLine(l);
    });
  });
}

init();
