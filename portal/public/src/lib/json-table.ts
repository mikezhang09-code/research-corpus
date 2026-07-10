// Shape detection for the universal JSON viewer. Turns common JSON layouts
// into rows + columns for a data table, and falls back to a raw/tree view for
// anything that isn't naturally tabular.

export type JsonAnalysis =
  | { kind: "table"; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: "tree" };

// Cap how many elements we scan for the column set — a huge array with a
// consistent shape doesn't need a full pass to know its columns.
const KEY_SAMPLE = 500;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Union of object keys in first-seen order (sampled for large inputs). */
function unionKeys(objs: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of objs.slice(0, KEY_SAMPLE)) {
    for (const k of Object.keys(o)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

/**
 * Pick the best table shape for a parsed JSON value:
 *  - array of objects       → columns = union of keys (the common case)
 *  - array of primitives    → single "value" column
 *  - array of arrays        → positional columns
 *  - object of objects      → "(key)" column + each record's fields
 *  - { data: [ … ] }        → unwrap the single array property
 * Anything else falls back to the raw/tree view.
 */
export function analyzeJson(data: unknown): JsonAnalysis {
  if (Array.isArray(data)) {
    if (data.length === 0) return { kind: "tree" };
    const objCount = data.reduce((n, el) => n + (isPlainObject(el) ? 1 : 0), 0);
    if (objCount >= Math.ceil(data.length * 0.6)) {
      const rows = data.map((el) => (isPlainObject(el) ? el : { "(value)": el }));
      const columns = unionKeys(rows);
      return columns.length ? { kind: "table", columns, rows } : { kind: "tree" };
    }
    if (data.every((x) => x === null || typeof x !== "object")) {
      return { kind: "table", columns: ["value"], rows: data.map((v) => ({ value: v })) };
    }
    if (data.every(Array.isArray)) {
      const maxLen = (data as unknown[][]).reduce((m, a) => Math.max(m, a.length), 0);
      const columns = Array.from({ length: maxLen }, (_, i) => `col ${i + 1}`);
      const rows = (data as unknown[][]).map((a) => {
        const r: Record<string, unknown> = {};
        a.forEach((v, i) => (r[`col ${i + 1}`] = v));
        return r;
      });
      return { kind: "table", columns, rows };
    }
    return { kind: "tree" };
  }

  if (isPlainObject(data)) {
    const entries = Object.entries(data);
    // { "data": [ … ] } style wrappers → show the inner array.
    const arrProps = entries.filter(([, v]) => Array.isArray(v));
    if (arrProps.length === 1) {
      const inner = analyzeJson(arrProps[0][1]);
      if (inner.kind === "table") return inner;
    }
    // Map of records: { "a": {…}, "b": {…} } → a "(key)" column + fields.
    const objVals = entries.filter(([, v]) => isPlainObject(v));
    if (entries.length > 0 && objVals.length >= Math.ceil(entries.length * 0.6)) {
      const columns = ["(key)", ...unionKeys(objVals.map(([, v]) => v as Record<string, unknown>))];
      const rows = entries.map(([k, v]) => ({ "(key)": k, ...(isPlainObject(v) ? v : { "(value)": v }) }));
      return { kind: "table", columns, rows };
    }
  }

  return { kind: "tree" };
}

/** Heuristic: does this parse look like an in-app mind-map node tree? */
export function looksLikeMindMap(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  const hasChildren = Array.isArray((data as { children?: unknown }).children);
  const hasLabel = ["text", "name", "label", "topic", "title"].some((k) => k in data);
  return hasChildren && hasLabel;
}

/** A cell value's compact text for the grid (nested values → short JSON). */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  }
  return String(v);
}

/** True when a cell holds a nested value worth expanding into a detail view. */
export function isExpandable(v: unknown): boolean {
  return v != null && typeof v === "object";
}
