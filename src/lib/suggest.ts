/**
 * suggest.ts — Query suggestion logic.
 *
 * No DOM API, no React, no vscode API dependencies.
 * Pure functions operating on strings and arrays.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SuggestItem {
  /** Display label */
  label: string;
  /** Text to insert into the query */
  insert: string;
  /** Category for icon display */
  kind: 'tag' | 'meta-key' | 'meta-value' | 'operator' | 'checked';
}

interface CursorContext {
  /** Full current token under the cursor */
  token: string;
  /** Start index of the token in the input string */
  start: number;
  /** End index of the token in the input string */
  end: number;
}

/* ------------------------------------------------------------------ */
/*  Token analysis                                                     */
/* ------------------------------------------------------------------ */

/** Find the token under the cursor position. */
export function getTokenAtCursor(value: string, cursor: number): CursorContext {
  let start = cursor;
  while (start > 0 && value[start - 1] !== ' ') start--;
  let end = cursor;
  while (end < value.length && value[end] !== ' ') end++;
  return { token: value.slice(start, end), start, end };
}

/* ------------------------------------------------------------------ */
/*  Build suggestions                                                  */
/* ------------------------------------------------------------------ */

/** Build suggestion list based on the current token being typed. */
export function buildSuggestions(
  token: string,
  tags: string[],
  metaKeys: string[],
  metaValues: Record<string, string[]>
): SuggestItem[] {
  const items: SuggestItem[] = [];

  // Handle negation prefix
  const isNeg = token.startsWith('!');
  const prefix = isNeg ? '!' : '';
  const body = isNeg ? token.slice(1) : token;

  // --- #tag suggestions ---
  if (body.startsWith('#')) {
    const partial = body.slice(1).toLowerCase();
    for (const t of tags) {
      if (partial === '' || t.toLowerCase().includes(partial)) {
        items.push({ label: `${prefix}#${t}`, insert: `${prefix}#${t}`, kind: 'tag' });
      }
    }
    return items;
  }

  // --- @key(value) suggestions ---
  if (body.startsWith('@')) {
    const inner = body.slice(1);
    const parenIdx = inner.indexOf('(');

    if (parenIdx === -1) {
      const partial = inner.toLowerCase();
      for (const k of metaKeys) {
        if (partial === '' || k.toLowerCase().includes(partial)) {
          items.push({ label: `${prefix}@${k}(…)`, insert: `${prefix}@${k}()`, kind: 'meta-key' });
        }
      }
    } else {
      const key = inner.slice(0, parenIdx);
      const valPart = inner.slice(parenIdx + 1).replace(/\)$/, '');
      const partial = valPart.toLowerCase();
      const vals = metaValues[key] || [];
      for (const v of vals) {
        if (partial === '' || v.toLowerCase().includes(partial)) {
          items.push({ label: `${prefix}@${key}(${v})`, insert: `${prefix}@${key}(${v})`, kind: 'meta-value' });
        }
      }
    }
    return items;
  }

  // --- key:value / key>value / key<value suggestions ---
  const opMatch = body.match(/^([\w.-]+)([:<>])(.*)$/);
  if (opMatch) {
    const [, key, op, valPart] = opMatch;
    if (key === 'checked') {
      for (const v of ['true', 'false']) {
        if (valPart === '' || v.startsWith(valPart)) {
          items.push({ label: `${prefix}checked:${v}`, insert: `${prefix}checked:${v}`, kind: 'checked' });
        }
      }
      return items;
    }
    const vals = metaValues[key] || [];
    const partial = valPart.toLowerCase();
    for (const v of vals) {
      if (partial === '' || v.toLowerCase().includes(partial)) {
        items.push({ label: `${prefix}${key}${op}${v}`, insert: `${prefix}${key}${op}${v}`, kind: 'meta-value' });
      }
    }
    if (op === '>' || op === '<') {
      for (const d of ['today', 'today+7', 'today+30', 'today-7', 'today-30']) {
        if (partial === '' || d.toLowerCase().includes(partial)) {
          items.push({ label: `${prefix}${key}${op}${d}`, insert: `${prefix}${key}${op}${d}`, kind: 'operator' });
        }
      }
    }
    return items;
  }

  // --- Bare token: could become a #tag, @key, key:, or text ---
  if (body === '') {
    items.push({ label: '#… (タグ検索)', insert: '#', kind: 'tag' });
    items.push({ label: '@… (メタ検索)', insert: '@', kind: 'meta-key' });
    items.push({ label: 'checked:… (チェック状態)', insert: 'checked:', kind: 'checked' });
    for (const k of metaKeys.slice(0, 5)) {
      items.push({ label: `${k}:… (値検索)`, insert: `${k}:`, kind: 'meta-key' });
    }
    return items;
  }

  const partial = body.toLowerCase();

  for (const t of tags) {
    if (t.toLowerCase().includes(partial)) {
      items.push({ label: `${prefix}#${t}`, insert: `${prefix}#${t}`, kind: 'tag' });
    }
  }

  for (const k of metaKeys) {
    if (k.toLowerCase().includes(partial)) {
      items.push({ label: `${prefix}${k}:… (値検索)`, insert: `${prefix}${k}:`, kind: 'meta-key' });
      items.push({ label: `${prefix}@${k}(…)`, insert: `${prefix}@${k}()`, kind: 'meta-key' });
    }
  }

  return items;
}
