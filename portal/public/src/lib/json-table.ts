// Shape detection + round-trip for the universal JSON viewer/editor. Turns
// common JSON layouts into rows + columns for a data table, records how to
// rebuild the original JSON from edited rows (`layout`), and falls back to a
// raw/tree view for anything that isn't cleanly tabular.

export type TableLayout =
  | { type: "objects" }
  | { type: "primitives" }
  | { type: "arrays" }
  | { type: "records" }
  | { type: "wrapper"; key: string; rest: Record<string, unknown> };

export type JsonAnalysis =
  | {
      kind: "table";
      columns: string[];
      rows: Record<string, unknown>[];
      // Non-null when the table round-trips losslessly, so it can be edited and
      // saved; null means "tabular enough to view, but edit via Raw only".
      layout: TableLayout | null;
    }
  | { kind: "tree" };

// Cap how many elements we scan for the column set — a huge array with a
// consistent shape doesn't need a full pass to know its columns.
const KEY_SAMPLE = 500;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function isPrimitive(v: unknown): boolean {
  return v == null || typeof v !== "object";
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
 * Pick the best table shape for a parsed JSON value. `layout` is set only when
 * rows rebuild the exact original JSON (so the table is safe to edit + save).
 */
export function analyzeJson(data: unknown): JsonAnalysis {
  if (Array.isArray(data)) {
    if (data.length === 0) return { kind: "tree" };
    if (data.every(isPlainObject)) {
      return { kind: "table", columns: unionKeys(data), rows: data, layout: { type: "objects" } };
    }
    if (data.every(isPrimitive)) {
      return { kind: "table", columns: ["value"], rows: data.map((v) => ({ value: v })), layout: { type: "primitives" } };
    }
    if (data.every(Array.isArray)) {
      const maxLen = (data as unknown[][]).reduce((m, a) => Math.max(m, a.length), 0);
      const columns = Array.from({ length: maxLen }, (_, i) => `col ${i + 1}`);
      const rows = (data as unknown[][]).map((a) => {
        const r: Record<string, unknown> = {};
        a.forEach((v, i) => (r[`col ${i + 1}`] = v));
        return r;
      });
      return { kind: "table", columns, rows, layout: { type: "arrays" } };
    }
    // Mixed array: still show a table (view-only), wrapping bare values.
    const objCount = data.reduce((n, el) => n + (isPlainObject(el) ? 1 : 0), 0);
    if (objCount >= Math.ceil(data.length * 0.6)) {
      const rows = data.map((el) => (isPlainObject(el) ? el : { "(value)": el }));
      const columns = unionKeys(rows);
      return columns.length ? { kind: "table", columns, rows, layout: null } : { kind: "tree" };
    }
    return { kind: "tree" };
  }

  if (isPlainObject(data)) {
    const entries = Object.entries(data);
    // { "data": [ … ] } style wrappers → edit the inner array in place.
    const arrProps = entries.filter(([, v]) => Array.isArray(v));
    if (arrProps.length === 1) {
      const [key, arr] = arrProps[0] as [string, unknown[]];
      if (arr.length > 0 && arr.every(isPlainObject)) {
        const rest = Object.fromEntries(entries.filter(([k]) => k !== key));
        return { kind: "table", columns: unionKeys(arr), rows: arr, layout: { type: "wrapper", key, rest } };
      }
      const inner = analyzeJson(arr);
      if (inner.kind === "table") return { ...inner, layout: null };
    }
    // Map of records: { "a": {…}, "b": {…} } → a "(key)" column + fields.
    const objVals = entries.filter(([, v]) => isPlainObject(v));
    if (entries.length > 0 && objVals.every(([, v]) => isPlainObject(v)) && objVals.length === entries.length) {
      const columns = ["(key)", ...unionKeys(objVals.map(([, v]) => v as Record<string, unknown>))];
      const rows = entries.map(([k, v]) => ({ "(key)": k, ...(v as Record<string, unknown>) }));
      return { kind: "table", columns, rows, layout: { type: "records" } };
    }
    if (entries.length > 0 && objVals.length >= Math.ceil(entries.length * 0.6)) {
      const columns = ["(key)", ...unionKeys(objVals.map(([, v]) => v as Record<string, unknown>))];
      const rows = entries.map(([k, v]) => ({ "(key)": k, ...(isPlainObject(v) ? v : { "(value)": v }) }));
      return { kind: "table", columns, rows, layout: null };
    }
  }

  return { kind: "tree" };
}

/** Rebuild the original-shaped JSON from (possibly edited) table rows. */
export function toJson(layout: TableLayout, columns: string[], rows: Record<string, unknown>[]): unknown {
  const strip = (r: Record<string, unknown>) => {
    const o = { ...r };
    delete o.__key;
    return o;
  };
  switch (layout.type) {
    case "objects":
      return rows.map(strip);
    case "primitives":
      return rows.map((r) => r.value ?? null);
    case "arrays":
      return rows.map((r) => {
        const arr = columns.map((c) => r[c]);
        // Drop trailing cells that were never present so jagged rows survive.
        let end = arr.length;
        while (end > 0 && arr[end - 1] === undefined) end--;
        return arr.slice(0, end).map((v) => (v === undefined ? null : v));
      });
    case "records":
      return Object.fromEntries(
        rows.map((r) => {
          const o = strip(r);
          const k = String(o["(key)"] ?? "");
          delete o["(key)"];
          return [k, o];
        }),
      );
    case "wrapper":
      return { ...layout.rest, [layout.key]: rows.map(strip) };
  }
}

/**
 * Coerce edited cell text back to a JSON value. Preserves the previous value's
 * type where possible (a number stays a number, a string stays a string), and
 * infers a type for brand-new cells.
 */
export function coerceCell(text: string, prev: unknown): unknown {
  const t = text.trim();
  if (typeof prev === "number") {
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : text;
  }
  if (typeof prev === "boolean") {
    if (t === "true") return true;
    if (t === "false") return false;
    return text;
  }
  if (typeof prev === "string") return text;
  // null / undefined (new cell) — infer.
  if (text === "") return null;
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  const n = Number(t);
  if (t !== "" && Number.isFinite(n) && String(n) === t) return n;
  return text;
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
