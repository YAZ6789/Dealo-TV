// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// fflate ships with read-excel-file; used here only to build a tiny .xlsx fixture.
import { strToU8 as rawStrToU8, zipSync } from 'fflate';

// jsdom's TextEncoder returns a cross-realm Uint8Array that fflate doesn't recognise as a file.
const strToU8 = (s: string) => new Uint8Array(rawStrToU8(s));
import { readSpreadsheetFile } from './excel';

function fakeFile(name: string, data: string | Uint8Array, type = ''): Blob & { name: string } {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return {
    name,
    type,
    size: bytes.byteLength,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Blob & { name: string };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Minimal valid .xlsx: inline-string text, numbers, booleans and a date-formatted serial. */
function buildXlsx(sheets: { name: string; rows: (string | number | boolean | { date: number } | null)[][] }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  );
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
            if (v === null) return '';
            if (typeof v === 'string') return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
            if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
            if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
            return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
          })
          .join('');
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return zipSync(files);
}

describe('readSpreadsheetFile', () => {
  it('reads CSV files', async () => {
    const res = await readSpreadsheetFile(fakeFile('my shows.csv', 'Show,Status\nDark,Watched\n'));
    expect(res).toEqual([{ name: 'my shows', table: { headers: ['Show', 'Status'], rows: [['Dark', 'Watched']] } }]);
  });

  it('reads TSV and TXT files', async () => {
    const tsv = await readSpreadsheetFile(fakeFile('list.tsv', 'Show\tRating\nDark\t9\n'));
    expect(tsv[0].table.rows).toEqual([['Dark', '9']]);
    const txt = await readSpreadsheetFile(fakeFile('list.TXT', 'Breaking Bad\nDark\n'));
    expect(txt[0].table).toEqual({ headers: ['Column A'], rows: [['Breaking Bad'], ['Dark']] });
  });

  it('returns [] for an empty CSV', async () => {
    expect(await readSpreadsheetFile(fakeFile('empty.csv', '\n\n'))).toEqual([]);
  });

  it('rejects legacy .xls with a helpful message', async () => {
    await expect(readSpreadsheetFile(fakeFile('old.xls', 'xx'))).rejects.toThrow(/save it as \.xlsx or CSV/);
  });

  it('rejects unknown formats', async () => {
    await expect(readSpreadsheetFile(fakeFile('photo.png', 'xx'))).rejects.toThrow(/Unsupported/);
    await expect(readSpreadsheetFile(fakeFile('sheet.numbers', 'xx'))).rejects.toThrow(/xlsx or CSV/);
  });

  it('reads every non-empty sheet of an .xlsx, converting dates, numbers and booleans', async () => {
    const bytes = buildXlsx([
      {
        name: 'Watched',
        rows: [
          ['My TV list', null, null, null],
          ['Title', 'Rating', 'Finished', 'Fav'],
          ['Breaking Bad', 9.5, { date: 45306 }, true],
          ['Dark', 8, null, false],
        ],
      },
      { name: 'Empty', rows: [] },
      { name: 'To watch', rows: [['Show'], ['Andor']] },
    ]);
    const res = await readSpreadsheetFile(fakeFile('tv.xlsx', bytes));
    expect(res.map((r) => r.name)).toEqual(['Watched', 'To watch']);
    expect(res[0].table.headers).toEqual(['Title', 'Rating', 'Finished', 'Fav']);
    expect(res[0].table.rows).toEqual([
      ['Breaking Bad', '9.5', '2024-01-15', 'TRUE'],
      ['Dark', '8', '', 'FALSE'],
    ]);
    expect(res[1].table).toEqual({ headers: ['Show'], rows: [['Andor']] });
  });

  it('reports a corrupt .xlsx clearly', async () => {
    await expect(readSpreadsheetFile(fakeFile('broken.xlsx', 'not a zip'))).rejects.toThrow(/Excel workbook/);
  });
});
