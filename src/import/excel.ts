/**
 * Local spreadsheet files: CSV/TSV/TXT and Excel .xlsx (one Table per sheet).
 * `read-excel-file` is imported lazily so it lands in its own chunk.
 */
import { cellToString, detectHeaderRow, parseCsv, type Table } from './table';

export interface NamedTable {
  name: string;
  table: Table;
}

type InputFile = File | (Blob & { name: string });

const baseName = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Sheet';

/**
 * Read a user-picked file into one table per sheet/tab.
 * Empty sheets are omitted, so the result may be `[]`.
 * @throws for legacy `.xls` and unsupported formats (message is user-facing)
 */
export async function readSpreadsheetFile(file: InputFile): Promise<NamedTable[]> {
  const name = file.name ?? '';
  const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  const type = (file.type ?? '').toLowerCase();

  if (ext === 'xls' || type === 'application/vnd.ms-excel') {
    throw new Error(
      'Old-style Excel (.xls) files aren’t supported. Open it in Excel, Numbers or Google Sheets and save it as .xlsx or CSV, then try again.',
    );
  }
  if (ext === 'numbers' || ext === 'ods') {
    throw new Error(`.${ext} files aren’t supported. Export the spreadsheet as .xlsx or CSV and try again.`);
  }

  if (['csv', 'tsv', 'txt', 'tab'].includes(ext) || /^text\/(?:csv|tab-separated-values|plain)/.test(type)) {
    const text = await file.text();
    const table = parseCsv(text);
    return table.headers.length ? [{ name: baseName(name), table }] : [];
  }

  if (['xlsx', 'xlsm', 'xltx'].includes(ext) || type.includes('spreadsheetml')) {
    const mod = await import('read-excel-file');
    const readXlsxFile = mod.default;
    const buffer = await file.arrayBuffer();
    let sheetNames: string[];
    try {
      sheetNames = await mod.readSheetNames(buffer);
    } catch {
      throw new Error('That file couldn’t be read as an Excel workbook. Try saving it again as .xlsx or CSV.');
    }
    const out: NamedTable[] = [];
    for (const sheet of sheetNames) {
      const rows = await readXlsxFile(buffer, { sheet });
      const table = detectHeaderRow(rows.map((r) => r.map((c) => cellToString(c))));
      if (table.headers.length) out.push({ name: sheet, table });
    }
    return out;
  }

  throw new Error('Unsupported file type. Choose a .xlsx, .csv or .tsv file.');
}
