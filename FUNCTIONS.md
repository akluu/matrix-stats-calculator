# Function and feature coverage

The original requested list contains **60 distinct functions**. Repeated entries for MMULT, MINVERSE, CORREL and NORM.S.DIST are counted once. The independent inventory is `tests/required-functions.json`.

## Math (10)

`EXP`, `LN`, `SQRT`, `ABS`, `MOD`, `FLOOR.MATH`, `CEILING.MATH`, `FACT`, `COMBIN`, `GAMMA`.

## Aggregates and statistics (16)

`SUM`, `SUMIF`, `SUMPRODUCT`, `PRODUCT`, `AVERAGE`, `COUNT`, `COUNTIF`, `MIN`, `MAX`, `VAR.S`, `VAR.P`, `STDEV.S`, `STDEV.P`, `DEVSQ`, `CORREL`, `PEARSON`.

## Distributions (10)

`POISSON.DIST`, `BINOM.DIST`, `NEGBINOM.DIST`, `EXPON.DIST`, `GAMMA.DIST`, `WEIBULL.DIST`, `BETA.DIST`, `NORM.DIST`, `NORM.S.DIST`, `LOGNORM.DIST`.

## Tests and quantiles (18)

`NORM.S.INV`, `CHISQ.TEST`, `CHISQ.DIST`, `CHISQ.DIST.RT`, `CHISQ.INV`, `CHISQ.INV.RT`, `T.TEST`, `T.DIST`, `T.DIST.2T`, `T.DIST.RT`, `T.INV`, `T.INV.2T`, `T.INV.RT`, `F.TEST`, `F.DIST`, `F.DIST.RT`, `F.INV`, `F.INV.RT`.

## Matrices (4)

`MMULT`, `MINVERSE`, `TRANSPOSE`, `MDETERM`.

## Regression (2)

`LINEST`, `RSQ`.

## Additional featured functions (46)

`POWER`, `LOG`, `LOG10`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `INT`, `PI`, `SIN`, `COS`, `TAN`, `COUNTA`, `MEDIAN`, `PERCENTILE.INC`, `NORM.INV`, `SLOPE`, `IF`, `IFERROR`, `AND`, `OR`, `NOT`, `INDEX`, `MATCH`, `VLOOKUP`, `SUMIFS`, `COUNTIFS`, `ROW`, `COLUMN`, `ROWS`, `COLUMNS`, `STANDARDIZE`, `COVARIANCE.S`, `COVARIANCE.P`, `SUMSQ`, `AVEDEV`, `GEOMEAN`, `HARMEAN`, `LARGE`, `SMALL`, `QUARTILE.INC`, `GAMMALN`, `GAMMA.INV`, `BETA.INV`, `LOGNORM.INV`, `AVERAGEIF`, `COUNTBLANK`.

## Coverage requirements

All 106 featured functions have worked examples that are executed as tests, including any stated input setup. VLOOKUP examples use sheet ranges; COUNTBLANK notes distinguish empty cells from empty strings in this calculator.

Every requested function must have a numerical result assertion, including complete matrix outputs. Registration alone does not count. `tests/functions.test.js` checks the inventory against numerical cases and the function catalog. Additional cases exercise density versus cumulative probability, tails, input errors, matrix singularity, and regression statistics.

The curated additional math, logic and lookup functions in `src/catalog.js` must also have numerical or Boolean examples. The engine exposes more functions through search; those are outside this verified list.

INT follows Excel’s floor behavior for negative numbers (for example, `INT(-1.2) = -2`); see [Microsoft’s INT reference](https://support.microsoft.com/en-us/office/int-function-a6c4af9e-356d-4369-ab6a-cb1fd9d343ef).

## Spreadsheet behavior

| Feature | Test suite |
| --- | --- |
| Formula dependencies, relative/mixed/absolute references, cross-sheet references | model + browser |
| Matrix spills, protected results, blocked-spill recovery | functions + model + browser |
| Drag, Shift-click/arrows, disjoint ranges, row/column/all selection | browser |
| Arrow/Tab/Enter, data-region jumps, Home/End/Page navigation | browser |
| F2/double-click, cancel, reference insertion, F4, completion and function search | helpers + browser |
| Copy/cut/paste, full precision, quoted TSV, invalid paste recovery | model + browser |
| Fill down/right, undo/redo | model + browser |
| Insert/delete rows and columns; add/rename/delete sheets | model + browser |
| Selection count/sum/average | browser |
| Column width and row height, virtualized scrolling, narrow sidebar | browser |
| Autosave/reopen, legacy storage, JSON backup import/export | model + browser |
| Stale-view protection and draft recovery | browser |
| Side-panel setup, local-only startup, bounded history and workbook limits | model + browser |

Clipboard browser tests dispatch ClipboardEvents with DataTransfer payloads. They verify application behavior, not the operating-system clipboard. The side-panel test verifies Chrome API configuration and opening through a user gesture; it does not drive the operating-system shortcut. Performance checks are local smoke tests, not timing guarantees.
