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
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

export function emptyHtml(icon: string): string {
  return `<div class="empty"><div class="empty-icon">${icon}</div><div>マッチする項目がありません</div></div>`;
}
