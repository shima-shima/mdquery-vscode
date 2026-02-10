/**
 * Markdown parser with Tag & Key-Value metadata extraction.
 *
 * Supported syntax:
 *   Tags:        #tag
 *   Annotation:  @key(value)
 *   Colon KV:    key:value
 *   HTML hidden: <!-- key:value -->
 *   Checkbox:    [ ] / [x]  (via remark-gfm listItem.checked)
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, ListItem, List, PhrasingContent, Heading } from "mdast";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ParsedItem {
  /** Clean text with all metadata markers removed */
  text: string;
  /** Original source line from the Markdown */
  rawLine: string;
  /** Extracted #tags (without the leading #) */
  tags: string[];
  /** Merged key-value metadata from @key(val), key:val, and <!-- k:v --> */
  meta: Record<string, string>;
  /** null = no checkbox, false = [ ], true = [x] */
  checked: boolean | null;
  /** 1-based source line number */
  line: number;
  /** Heading level 1-4 if this item represents a heading, undefined otherwise */
  headingLevel?: number;
  /** Nested child items */
  children?: ParsedItem[];
}

/* ------------------------------------------------------------------ */
/*  Regex patterns                                                     */
/* ------------------------------------------------------------------ */

/** HTML comment metadata: <!-- key:value --> */
const HTML_COMMENT_RE = /<!--\s*([\w.-]+)\s*:\s*([^>]*?)\s*-->/g;

/** Tags: #tag (preceded by start-of-string or whitespace) */
const TAG_RE = /(^|\s)#([^\s#]+)/g;

/** Inline annotation: @key(value) */
const ANNOTATION_RE = /@([\w.-]+)\(([^)]*)\)/g;

/** Colon KV: key:value (no spaces in value). Excludes URL schemes. */
const COLON_KV_RE = /(?:^|\s)([a-zA-Z_][\w.-]*):(\S+)/g;
const URL_SCHEMES = new Set([
  "http", "https", "ftp", "ftps", "mailto", "tel", "ssh", "git",
  "file", "data", "javascript", "ws", "wss",
]);

/* ------------------------------------------------------------------ */
/*  Extraction helpers                                                 */
/* ------------------------------------------------------------------ */

function extractText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.value;
      if (node.type === "html") return node.value; // preserve HTML comments
      if ("children" in node)
        return extractText(node.children as PhrasingContent[]);
      if (node.type === "inlineCode") return `\`${node.value}\``;
      return "";
    })
    .join("");
}

/**
 * Extract all metadata from the full text of a list item.
 * Returns { tags, meta, cleanText }.
 */
function extractMetadata(fullText: string): {
  tags: string[];
  meta: Record<string, string>;
  cleanText: string;
} {
  const tags: string[] = [];
  const meta: Record<string, string> = {};
  let text = fullText;

  // 1) HTML comments: <!-- key:value -->
  text = text.replace(HTML_COMMENT_RE, (_, key: string, value: string) => {
    meta[key] = value.trim();
    return "";
  });

  // 2) Inline annotations: @key(value)
  text = text.replace(ANNOTATION_RE, (_, key: string, value: string) => {
    meta[key] = value;
    return "";
  });

  // 3) Tags: #tag
  text = text.replace(TAG_RE, (_, prefix: string, tag: string) => {
    tags.push(tag);
    return prefix; // keep the leading whitespace
  });

  // 4) Colon KV: key:value (skip URL schemes)
  text = text.replace(COLON_KV_RE, (match, key: string, value: string) => {
    if (URL_SCHEMES.has(key.toLowerCase())) return match;
    meta[key] = value;
    return "";
  });

  // 5) Clean up whitespace
  const cleanText = text.replace(/\s+/g, " ").trim();

  return { tags, meta, cleanText };
}

/* ------------------------------------------------------------------ */
/*  List item processing                                               */
/* ------------------------------------------------------------------ */

function processListItem(
  item: ListItem,
  sourceLines: string[]
): ParsedItem {
  let fullText = "";
  const nestedItems: ParsedItem[] = [];

  for (const child of item.children) {
    if (child.type === "paragraph") {
      fullText += extractText(child.children);
    } else if (child.type === "list") {
      for (const nested of (child as List).children) {
        nestedItems.push(processListItem(nested, sourceLines));
      }
    }
  }

  const { tags, meta, cleanText } = extractMetadata(fullText);

  const lineNum = item.position?.start.line ?? 0;
  const rawLine = lineNum > 0 ? sourceLines[lineNum - 1] : "";

  const result: ParsedItem = {
    text: cleanText,
    rawLine,
    tags,
    meta,
    checked: item.checked ?? null,
    line: lineNum,
  };

  if (nestedItems.length > 0) {
    result.children = nestedItems;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Heading processing                                                 */
/* ------------------------------------------------------------------ */

function processHeading(
  heading: Heading,
  sourceLines: string[]
): ParsedItem {
  const fullText = extractText(heading.children);
  const { tags, meta, cleanText } = extractMetadata(fullText);

  const lineNum = heading.position?.start.line ?? 0;
  const rawLine = lineNum > 0 ? sourceLines[lineNum - 1] : "";

  return {
    text: cleanText,
    rawLine,
    tags,
    meta,
    checked: null,
    line: lineNum,
    headingLevel: heading.depth,
    children: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse Markdown and return a tree of ParsedItem.
 *
 * Headings (depth 1-4) become structural nodes whose children contain
 * subsequent list items and sub-headings, based on heading-level hierarchy.
 * Lists appearing before any heading are placed at the root level.
 */
export function parseMarkdown(markdown: string): ParsedItem[] {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree = processor.parse(markdown) as Root;
  const sourceLines = markdown.split("\n");
  const rootItems: ParsedItem[] = [];

  // Stack of heading ParsedItems currently open.
  const stack: ParsedItem[] = [];

  /** Return the children array to append into: either the top of stack or root. */
  function currentChildren(): ParsedItem[] {
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top.children) top.children = [];
      return top.children;
    }
    return rootItems;
  }

  /** Collect list items from a top-level list node. */
  function collectListItems(list: List): ParsedItem[] {
    return list.children.map((li) => processListItem(li, sourceLines));
  }

  for (const child of tree.children) {
    if (child.type === "heading" && child.depth >= 2 && child.depth <= 4) {
      const headingItem = processHeading(child as Heading, sourceLines);

      // Pop stack until the top has a level strictly less than this heading
      while (
        stack.length > 0 &&
        (stack[stack.length - 1].headingLevel ?? 0) >= child.depth
      ) {
        stack.pop();
      }

      // Append this heading as a child of whatever is now current
      currentChildren().push(headingItem);

      // Push onto stack so subsequent content nests under it
      stack.push(headingItem);
    } else if (child.type === "list") {
      const listItems = collectListItems(child as List);
      currentChildren().push(...listItems);
    }
    // Other node types (paragraphs, code blocks, etc.) are ignored
  }

  // Clean up empty children arrays on headings that ended up with none
  function pruneEmptyChildren(items: ParsedItem[]) {
    for (const item of items) {
      if (item.children) {
        if (item.children.length === 0) {
          delete item.children;
        } else {
          pruneEmptyChildren(item.children);
        }
      }
    }
  }
  pruneEmptyChildren(rootItems);

  return rootItems;
}

/** Recursively count all items. */
export function countItems(items: ParsedItem[]): number {
  return items.reduce(
    (n, it) => n + 1 + (it.children ? countItems(it.children) : 0),
    0
  );
}

/** Flat representation with depth & ancestor flag. */
export interface FlatItem extends ParsedItem {
  depth: number;
  isAncestor: boolean;
}

export function flattenItems(
  items: ParsedItem[],
  depth = 0,
  ancestorLines?: Set<number>
): FlatItem[] {
  const out: FlatItem[] = [];
  for (const it of items) {
    out.push({
      ...it,
      depth,
      isAncestor: ancestorLines ? ancestorLines.has(it.line) : false,
    });
    if (it.children)
      out.push(...flattenItems(it.children, depth + 1, ancestorLines));
  }
  return out;
}

export function collectRawLines(items: ParsedItem[]): string[] {
  const lines: string[] = [];
  for (const it of items) {
    lines.push(it.rawLine);
    if (it.children) lines.push(...collectRawLines(it.children));
  }
  return lines;
}

/** Collect all meta keys (recursive). */
export function getAllMetaKeys(items: ParsedItem[]): string[] {
  const keys = new Set<string>();
  (function walk(list: ParsedItem[]) {
    for (const it of list) {
      for (const k of Object.keys(it.meta)) keys.add(k);
      if (it.children) walk(it.children);
    }
  })(items);
  return Array.from(keys).sort();
}

/** Collect all unique tags (recursive). */
export function getAllTags(items: ParsedItem[]): string[] {
  const tags = new Set<string>();
  (function walk(list: ParsedItem[]) {
    for (const it of list) {
      for (const t of it.tags) tags.add(t);
      if (it.children) walk(it.children);
    }
  })(items);
  return Array.from(tags).sort();
}
