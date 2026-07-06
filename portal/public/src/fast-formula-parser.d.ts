// Minimal ambient types for fast-formula-parser (ships none). Covers only the
// small surface we use in lib/sheet-recalc.ts.
declare module "fast-formula-parser" {
  interface CellRef {
    sheet?: string;
    row: number; // 1-based
    col: number; // 1-based
  }
  interface RangeRef {
    sheet?: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }
  interface ParserConfig {
    onCell?: (ref: CellRef) => unknown;
    onRange?: (ref: RangeRef) => unknown[][];
  }
  interface Position {
    sheet?: string;
    row: number;
    col: number;
  }
  export default class FormulaParser {
    constructor(config?: ParserConfig);
    parse(formula: string, position: Position): unknown;
  }
}
