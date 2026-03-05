/**
 * renderers.ts — Pure rendering functions that produce HTML strings.
 *
 * No DOM API, no React, no vscode API dependencies.
 * Only depends on markdown-parser.ts types.
 */
import type { ParsedItem, FlatItem } from './markdown-parser';

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/*  SVG icon constants (Lucide-style)                                   */
/* ------------------------------------------------------------------ */

const SVG_CHECK_SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`;
const SVG_SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`;
const SVG_CHEVRON_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-icon chevron-icon"><path d="m9 18 6-6-6-6"/></svg>`;
const SVG_HEADING = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-icon heading-svg"><path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/></svg>`;
const SVG_HASH = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>`;

/* ------------------------------------------------------------------ */
/*  Badge / icon helpers                                               */
/* ------------------------------------------------------------------ */

export function checkIconHtml(checked: boolean | null): string {
  if (checked === null) return '';
  return checked
    ? `<span class="check-icon checked">${SVG_CHECK_SQUARE}</span>`
    : `<span class="check-icon unchecked">${SVG_SQUARE}</span>`;
}

export function tagBadgesHtml(tags: string[]): string {
  return tags.map(t => `<span class="badge badge-tag">${SVG_HASH}${esc(t)}</span>`).join('');
}

export function metaBadgesHtml(meta: Record<string, string>): string {
  return Object.entries(meta).map(
    ([k, v]) => `<span class="badge badge-meta"><span class="meta-key">${esc(k)}</span>:${esc(v)}</span>`
  ).join('');
}

/* ------------------------------------------------------------------ */
/*  Raw lines                                                          */
/* ------------------------------------------------------------------ */

export function collectRawLines(items: ParsedItem[]): string[] {
  const lines: string[] = [];
  for (const it of items) {
    lines.push(it.rawLine);
    if (it.children) lines.push(...collectRawLines(it.children));
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/*  Markdown lines HTML                                                */
/* ------------------------------------------------------------------ */

export function mdLinesHtml(items: ParsedItem[], ancestorLines: Set<number>): string {
  let html = '';
  for (const it of items) {
    const isAnc = ancestorLines.has(it.line);
    const isH = !!it.headingLevel;
    html += `<span class="md-line${isAnc ? ' ancestor' : ''}${isH ? ' heading' : ''}" data-line="${it.line}">${esc(it.rawLine)}`;
    if (isAnc) html += `<span class="parent-label">← parent</span>`;
    html += `</span>\n`;
    if (it.children) html += mdLinesHtml(it.children, ancestorLines);
  }
  return html;
}

/* ------------------------------------------------------------------ */
/*  Flatten items                                                      */
/* ------------------------------------------------------------------ */

export function flattenItems(items: ParsedItem[], depth = 0, ancestorLines?: Set<number>): FlatItem[] {
  const out: FlatItem[] = [];
  for (const it of items) {
    out.push({ ...it, depth, isAncestor: ancestorLines ? ancestorLines.has(it.line) : false });
    if (it.children) out.push(...flattenItems(it.children, depth + 1, ancestorLines));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Table HTML                                                         */
/* ------------------------------------------------------------------ */

export function renderTableHtml(items: ParsedItem[], metaKeys: string[], ancestorLines: Set<number>): string {
  const flat = flattenItems(items, 0, ancestorLines);
  if (flat.length === 0) return emptyHtml('📊');

  let html = `<div class="table-wrap"><table class="data-table"><thead><tr><th>☐</th><th>Line</th><th>Text</th><th>Tags</th>`;
  for (const k of metaKeys) html += `<th class="mono">${esc(k)}</th>`;
  html += `</tr></thead><tbody>`;

  for (const it of flat) {
    html += `<tr class="${it.isAncestor ? 'ancestor' : ''}" data-line="${it.line}">`;
    html += `<td class="check-cell">${checkIconHtml(it.checked)}</td>`;
    html += `<td class="line-cell">${it.line}</td>`;
    html += `<td class="text-cell"><span style="padding-left:${it.depth * 12}px;display:inline-flex;align-items:center;gap:4px">`;
    if (it.headingLevel) {
      html += `${SVG_HEADING}<span style="font-weight:700">${esc(it.text)}</span><span class="heading-badge">H${it.headingLevel}</span>`;
    } else {
      if (it.depth > 0) html += SVG_CHEVRON_RIGHT;
      html += esc(it.text);
    }
    if (it.isAncestor) html += ` <span class="ancestor-label">parent</span>`;
    html += `</span></td><td><div style="display:flex;gap:4px;flex-wrap:wrap">${tagBadgesHtml(it.tags)}</div></td>`;
    for (const k of metaKeys) {
      html += `<td class="meta-cell">${it.meta[k] ? `<span class="has-value">${esc(it.meta[k])}</span>` : '<span class="no-value">—</span>'}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

/* ------------------------------------------------------------------ */
/*  Calendar HTML                                                      */
/* ------------------------------------------------------------------ */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Collect date→items map from all meta values matching YYYY-MM-DD. */
export function collectDateMap(items: ParsedItem[]): Map<string, { item: ParsedItem; key: string }[]> {
  const map = new Map<string, { item: ParsedItem; key: string }[]>();
  const walk = (list: ParsedItem[]) => {
    for (const it of list) {
      for (const [k, v] of Object.entries(it.meta)) {
        if (ISO_DATE_RE.test(v)) {
          let arr = map.get(v);
          if (!arr) { arr = []; map.set(v, arr); }
          arr.push({ item: it, key: k });
        }
      }
      if (it.children) walk(it.children);
    }
  };
  walk(items);
  return map;
}

/** Find the earliest month (as {year,month}) that has items, or null. */
export function findEarliestMonth(dateMap: Map<string, unknown>): { year: number; month: number } | null {
  let earliest: string | null = null;
  for (const d of dateMap.keys()) {
    if (!earliest || d < earliest) earliest = d;
  }
  if (!earliest) return null;
  const [y, m] = earliest.split('-').map(Number);
  return { year: y, month: m };
}

export function renderCalendarHtml(
  items: ParsedItem[],
  ancestorLines: Set<number>,
  year: number,
  month: number,
): string {
  const dateMap = collectDateMap(items);

  if (dateMap.size === 0) {
    return emptyHtml('📅', '日付メタデータが見つかりません');
  }

  // Month info
  const firstDay = new Date(year, month - 1, 1);
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  const pad = (n: number) => String(n).padStart(2, '0');

  let html = `<div class="cal-container">`;

  // Header row with navigation
  html += `<div class="cal-header">`;
  html += `<button class="btn cal-nav" data-cal-nav="prev">◀</button>`;
  html += `<span class="cal-title">${year}年${month}月</span>`;
  html += `<button class="btn cal-nav" data-cal-nav="next">▶</button>`;
  html += `</div>`;

  // Day-of-week labels (separate row outside the grid)
  const DOW = ['月', '火', '水', '木', '金', '土', '日'];
  html += `<div class="cal-dow-row">`;
  for (const d of DOW) {
    html += `<div class="cal-dow">${d}</div>`;
  }
  html += `</div>`;

  // Day cells
  html += `<div class="cal-grid">`;

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startDow + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;

    if (!inMonth) {
      html += `<div class="cal-cell cal-cell-empty"></div>`;
      continue;
    }

    const dateStr = `${year}-${pad(month)}-${pad(dayNum)}`;
    const entries = dateMap.get(dateStr) || [];
    const isToday = (() => {
      const now = new Date();
      return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === dayNum;
    })();
    const hasItems = entries.length > 0;

    html += `<div class="cal-cell${isToday ? ' cal-today' : ''}${hasItems ? ' cal-has-items' : ''}">` ;
    html += `<div class="cal-day-num">${dayNum}</div>`;
    html += `<div class="cal-items">`;
    for (const { item } of entries) {
      const isAnc = ancestorLines.has(item.line);
      html += `<div class="cal-item${isAnc ? ' ancestor' : ''}" data-line="${item.line}" data-tooltip="${esc(item.text)}">`;
      if (item.checked === true) html += `<span class="cal-check">✓</span>`;
      else if (item.checked === false) html += `<span class="cal-uncheck">○</span>`;
      html += `${esc(item.text)}</div>`;
    }
    html += `</div></div>`;
  }

  html += `</div></div>`;
  return html;
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

export function emptyHtml(icon: string, message = 'マッチする項目がありません'): string {
  return `<div class="empty"><div class="empty-icon">${icon}</div><div>${esc(message)}</div></div>`;
}
