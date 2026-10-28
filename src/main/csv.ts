import { readFile } from 'node:fs/promises';
import type { CsvKind, CsvDocument } from '../shared/types.js';

export function parseCsv(source: string): string[][] {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('CSV contains an unterminated quoted field.');
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export async function readCsv(path: string, kind: CsvKind): Promise<CsvDocument> {
  let rows = parseCsv(await readFile(path, 'utf8'));
  if (rows.length === 0) throw new Error(`${kind} is empty.`);

  let headers: string[];
  if (kind === 'Addresses.csv') {
    headers = rows.shift()?.map((header) => header.trim()) ?? [];
  } else {
    headers = ['Operator', 'Employee ID'];
    rows = rows.map((row) => {
      const value = row.join(',').trim();
      const match = /^(\S+)\s+(\S+)\s+(.*)$/.exec(value);
      return match ? [match[1] + ' ' + match[2], match[3] ?? ''] : [value, ''];
    });
  }

  return { kind, headers, rows };
}
