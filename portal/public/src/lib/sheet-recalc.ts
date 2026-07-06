/**
 * Lightweight, best-effort recalculation of a sheet's formulas.
 *
 * SheetJS's community build never evaluates formulas, so after an edit a
 * formula cell (or a formula that depends on an edited input) would keep its
 * stale cached value in the read-only "Plain" viewer. This recomputes formula
 * results from the editor grid so the save can bake fresh `<v>` cached values
 * into the file.
 *
 * "Best effort" by design: anything we can't confidently evaluate — cross-sheet
 * references, errors (#DIV/0! etc.), unsupported functions — is omitted from
 * the result, so we never write a *wrong* cached value (the cell just falls
 * back to formula-only, recalculated by Excel/Office on open).
 *
 * Only loaded on Save (dynamic import), so fast-formula-parser stays out of the
 * editor's initial chunk.
 */
import FormulaParser from "fast-formula-parser";
import { isFormula, type CellVal } from "./sheet-edit";

// Editor cells are text; turn a plain cell into the number/string the parser
// should see. Formula cells resolve via recursion, not this.
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;
function literal(text: string): CellVal | null {
  if (text === "") return null;
  const t = text.trim();
  return t !== "" && NUMERIC.test(t) ? Number(t) : text;
}

function normalize(res: unknown): CellVal | undefined {
  if (typeof res === "number" || typeof res === "string" || typeof res === "boolean") return res;
  return undefined; // null, FormulaError objects, arrays, etc.
}

/**
 * Recompute every formula cell in one sheet. Returns a map keyed by
 * `"row,col"` (0-based grid coords) → computed value, only for cells we could
 * resolve.
 */
export function recalcSheet(values: string[][], sheetName: string): Map<string, CellVal> {
  // Mutually recursive with evalCell (the parser resolves cells via evalCell,
  // which parses nested formulas via the parser), so this is assigned below.
  // eslint-disable-next-line prefer-const
  let parser: FormulaParser;
  const memo = new Map<string, CellVal | null>();
  const active = new Set<string>();

  // 0-based grid coords → value (number/string/bool) or null when empty/unknown.
  function evalCell(r: number, c: number): CellVal | null {
    const key = `${r},${c}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const text = values[r]?.[c] ?? "";
    if (!isFormula(text)) {
      const lit = literal(text);
      memo.set(key, lit);
      return lit;
    }
    if (active.has(key)) return 0; // circular reference — break the loop
    active.add(key);
    let out: CellVal | null;
    try {
      out = normalize(parser.parse(text.slice(1), { sheet: sheetName, row: r + 1, col: c + 1 })) ?? null;
    } catch {
      out = null;
    }
    active.delete(key);
    memo.set(key, out);
    return out;
  }

  parser = new FormulaParser({
    onCell: ({ sheet, row, col }) => {
      if (sheet && sheet !== sheetName) throw new Error("cross-sheet reference");
      return evalCell(row - 1, col - 1);
    },
    onRange: ({ sheet, from, to }) => {
      if (sheet && sheet !== sheetName) throw new Error("cross-sheet reference");
      const out: (CellVal | null)[][] = [];
      for (let r = from.row; r <= to.row; r++) {
        const line: (CellVal | null)[] = [];
        for (let c = from.col; c <= to.col; c++) line.push(evalCell(r - 1, c - 1));
        out.push(line);
      }
      return out;
    },
  });

  const result = new Map<string, CellVal>();
  for (let r = 0; r < values.length; r++) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (isFormula(row[c] ?? "")) {
        const v = evalCell(r, c);
        if (v != null) result.set(`${r},${c}`, v);
      }
    }
  }
  return result;
}
