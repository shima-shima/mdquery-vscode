/**
 * Simple YAML front matter parser/writer for mdquery-clips.
 *
 * Front matter format:
 * ---
 * mdquery-clips:
 *   - label: "my filter"
 *     expr: "#tag"
 * ---
 *
 * We intentionally avoid pulling in a full YAML library.
 * The subset we need is tiny: a list of { label, expr } objects.
 */

export interface SavedFilter {
  id: string;
  label: string;
  expr: string;
}

/** Regex to match YAML front matter at the start of the document */
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

/**
 * Parse mdquery-clips from Markdown front matter.
 * Returns the array of saved filters, or [] if none found.
 */
export function parseFrontMatterClips(text: string): SavedFilter[] {
  const m = FM_RE.exec(text);
  if (!m) return [];
  const yaml = m[1];
  return parseClipsFromYaml(yaml);
}

/**
 * Extract the mdquery-clips block from YAML text.
 * Handles the simple YAML subset we generate.
 */
function parseClipsFromYaml(yaml: string): SavedFilter[] {
  const lines = yaml.split(/\r?\n/);
  // Find the "mdquery-clips:" key
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^mdquery-clips\s*:/.test(lines[i].trim())) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return [];

  const filters: SavedFilter[] = [];
  let current: Partial<SavedFilter> = {};
  let idCounter = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Stop if we hit a non-indented line (another top-level key)
    if (line.length > 0 && !/^\s/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // List item start: "- label: ..."
    const listMatch = trimmed.match(/^-\s+(.*)$/);
    if (listMatch) {
      // Save previous if any
      if (current.label !== undefined && current.expr !== undefined) {
        filters.push({
          id: current.id || `fm${idCounter++}`,
          label: current.label,
          expr: current.expr,
        });
      }
      current = {};
      // Parse the key on the same line as "-"
      parseKV(listMatch[1], current);
      continue;
    }

    // Continuation line: "  expr: ..."
    parseKV(trimmed, current);
  }

  // Push last
  if (current.label !== undefined && current.expr !== undefined) {
    filters.push({
      id: current.id || `fm${idCounter++}`,
      label: current.label,
      expr: current.expr,
    });
  }

  return filters;
}

function parseKV(s: string, out: Partial<SavedFilter>) {
  const kvMatch = s.match(/^(\w+)\s*:\s*(.*)$/);
  if (!kvMatch) return;
  const key = kvMatch[1];
  const val = unquoteYaml(kvMatch[2]);
  if (key === 'label') out.label = val;
  else if (key === 'expr') out.expr = val;
  else if (key === 'id') out.id = val;
}

/** Remove surrounding quotes from a YAML string value */
function unquoteYaml(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return s;
}

/** Quote a string for YAML if needed */
function quoteYaml(s: string): string {
  if (/[:#{}\[\],&*?|><!%@`"']/.test(s) || s.trim() !== s || s === '') {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

/**
 * Serialize clips to the mdquery-clips YAML block.
 * Returns lines like:
 *   mdquery-clips:
 *     - label: "foo"
 *       expr: "#bar"
 */
function clipsToYaml(filters: SavedFilter[]): string {
  if (filters.length === 0) return '';
  const lines = ['mdquery-clips:'];
  for (const f of filters) {
    lines.push(`  - label: ${quoteYaml(f.label)}`);
    lines.push(`    expr: ${quoteYaml(f.expr)}`);
  }
  return lines.join('\n');
}

/**
 * Update the document text with the new clips in front matter.
 * - If front matter exists, update/add the mdquery-clips block.
 * - If no front matter, prepend one.
 * Returns the new full document text.
 */
export function updateFrontMatterClips(text: string, filters: SavedFilter[]): string {
  const m = FM_RE.exec(text);

  if (m) {
    // Front matter exists — update it
    const yamlContent = m[1];
    const newYaml = replaceClipsInYaml(yamlContent, filters);

    // If the new yaml is empty (no clips and no other content), remove front matter entirely
    if (newYaml.trim() === '') {
      return text.slice(m[0].length);
    }

    const lineEnding = m[0].includes('\r\n') ? '\r\n' : '\n';
    const newFm = `---${lineEnding}${newYaml}${lineEnding}---${lineEnding}`;
    return newFm + text.slice(m[0].length);
  } else {
    // No front matter — create one if we have clips
    if (filters.length === 0) return text;
    const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
    const yaml = clipsToYaml(filters);
    return `---${lineEnding}${yaml}${lineEnding}---${lineEnding}${text}`;
  }
}

/**
 * Replace the mdquery-clips section in existing YAML content.
 * Preserves other front matter keys.
 */
function replaceClipsInYaml(yaml: string, filters: SavedFilter[]): string {
  const lines = yaml.split(/\r?\n/);
  const resultLines: string[] = [];
  let inClips = false;
  let foundClips = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^mdquery-clips\s*:/.test(line.trim())) {
      foundClips = true;
      inClips = true;
      // Insert new clips here
      if (filters.length > 0) {
        resultLines.push(...clipsToYaml(filters).split('\n'));
      }
      continue;
    }

    if (inClips) {
      // Skip indented lines (part of old clips block)
      if (line.length > 0 && /^\s/.test(line)) continue;
      if (line.trim() === '') continue;
      // Hit a new top-level key — stop skipping
      inClips = false;
    }

    resultLines.push(line);
  }

  // If clips section didn't exist yet, append it
  if (!foundClips && filters.length > 0) {
    resultLines.push(...clipsToYaml(filters).split('\n'));
  }

  return resultLines.join('\n');
}
