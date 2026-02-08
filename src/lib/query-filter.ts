/**
 * Custom query engine for the Tag & Key-Value filter syntax.
 *
 * Query language:
 *   #tag              tag match
 *   !#tag             negated tag
 *   @key(value)       meta exact match
 *   key:value         meta partial match (substring, case-insensitive)
 *   key>value         comparison (numeric or lexicographic / date)
 *   key<value         comparison
 *   checked:true      checkbox state
 *   checked:false
 *   bareWord          text substring search (case-insensitive)
 *   !expr             negate any of the above
 *   (space)           AND
 *   OR                OR  (must be surrounded by spaces)
 *
 * Tree-aware: ancestors are included when descendants match.
 */
import { type ParsedItem, countItems } from "./markdown-parser";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Condition =
  | { kind: "tag"; tag: string; neg: boolean }
  | { kind: "meta"; key: string; value: string; neg: boolean }
  | { kind: "cmp"; key: string; op: ">" | "<"; value: string }
  | { kind: "checked"; value: boolean; neg: boolean }
  | { kind: "text"; text: string; neg: boolean };

/** A query is OR-of-AND groups. */
type Query = Condition[][];

export interface FilterResult {
  items: ParsedItem[];
  error: string | null;
  totalCount: number;
  matchedCount: number;
  ancestorLines: Set<number>;
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

function classifyToken(raw: string): Condition {
  let neg = false;
  let tok = raw;
  if (tok.startsWith("!")) {
    neg = true;
    tok = tok.slice(1);
  }

  // #tag
  if (tok.startsWith("#") && tok.length > 1) {
    return { kind: "tag", tag: tok.slice(1), neg };
  }

  // @key(value)
  const annoM = tok.match(/^@([\w.-]+)\(([^)]*)\)$/);
  if (annoM) {
    return { kind: "meta", key: annoM[1], value: annoM[2], neg };
  }

  // key>value  key<value  (not negated – negation on comparisons is odd)
  if (!neg) {
    const cmpM = tok.match(/^([\w.-]+)([><])(.+)$/);
    if (cmpM) {
      return {
        kind: "cmp",
        key: cmpM[1],
        op: cmpM[2] as ">" | "<",
        value: cmpM[3],
      };
    }
  }

  // key:value
  const kvM = tok.match(/^([\w.-]+):(.+)$/);
  if (kvM) {
    const key = kvM[1];
    const val = kvM[2];
    if (key === "checked") {
      return { kind: "checked", value: val === "true", neg };
    }
    return { kind: "meta", key, value: val, neg };
  }

  // bare text search
  return { kind: "text", text: tok, neg };
}

function parseQuery(expression: string): Query {
  const trimmed = expression.trim();
  if (!trimmed) return [];

  // Split by ` OR ` (case-sensitive, surrounded by spaces)
  const orGroups = trimmed.split(/\s+OR\s+/);

  return orGroups.map((group) => {
    const tokens = group.trim().split(/\s+/).filter(Boolean);
    return tokens.map(classifyToken);
  });
}

/* ------------------------------------------------------------------ */
/*  Evaluation                                                         */
/* ------------------------------------------------------------------ */

function smartCompare(a: string, b: string, op: ">" | "<"): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) {
    return op === ">" ? na > nb : na < nb;
  }
  // lexicographic (works for ISO dates like 2024-03-01)
  return op === ">" ? a > b : a < b;
}

function evalCondition(c: Condition, item: ParsedItem): boolean {
  let result: boolean;
  switch (c.kind) {
    case "tag":
      result = item.tags.some(
        (t) => t.toLowerCase() === c.tag.toLowerCase()
      );
      return c.neg ? !result : result;

    case "meta": {
      const val = item.meta[c.key];
      result =
        val !== undefined &&
        val.toLowerCase().includes(c.value.toLowerCase());
      return c.neg ? !result : result;
    }

    case "cmp": {
      const val = item.meta[c.key];
      if (val === undefined) return false;
      return smartCompare(val, c.value, c.op);
    }

    case "checked":
      result = item.checked === c.value;
      return c.neg ? !result : result;

    case "text":
      result = item.text.toLowerCase().includes(c.text.toLowerCase());
      return c.neg ? !result : result;
  }
}

function evalQuery(query: Query, item: ParsedItem): boolean {
  if (query.length === 0) return true;
  // OR of ANDs
  return query.some((andGroup) =>
    andGroup.every((cond) => evalCondition(cond, item))
  );
}

/* ------------------------------------------------------------------ */
/*  Tree-aware filter                                                  */
/* ------------------------------------------------------------------ */

function filterTree(
  items: ParsedItem[],
  query: Query
): [ParsedItem[], number, Set<number>] {
  const result: ParsedItem[] = [];
  let matchCount = 0;
  const ancestorLines = new Set<number>();

  for (const item of items) {
    const selfMatches = evalQuery(query, item);

    if (selfMatches) {
      result.push(item);
      matchCount += 1 + (item.children ? countItems(item.children) : 0);
    } else if (item.children) {
      const [childResult, childCount, childAnc] = filterTree(
        item.children,
        query
      );
      if (childResult.length > 0) {
        result.push({ ...item, children: childResult });
        matchCount += childCount;
        ancestorLines.add(item.line);
        for (const l of childAnc) ancestorLines.add(l);
      }
    }
  }

  return [result, matchCount, ancestorLines];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function filterItems(
  items: ParsedItem[],
  expression: string
): FilterResult {
  const totalCount = countItems(items);
  const empty: FilterResult = {
    items: [],
    error: null,
    totalCount,
    matchedCount: 0,
    ancestorLines: new Set(),
  };

  if (!expression.trim()) {
    return {
      items,
      error: null,
      totalCount,
      matchedCount: totalCount,
      ancestorLines: new Set(),
    };
  }

  let query: Query;
  try {
    query = parseQuery(expression);
  } catch (e) {
    return {
      ...empty,
      error: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    const [matched, matchedCount, ancestorLines] = filterTree(items, query);
    return { items: matched, error: null, totalCount, matchedCount, ancestorLines };
  } catch (e) {
    return {
      ...empty,
      error: `Filter error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
