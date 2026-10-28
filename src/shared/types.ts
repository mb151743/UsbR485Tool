export type CsvKind = 'Addresses.csv' | 'operator.csv';

export interface CsvDocument {
  kind: CsvKind;
  headers: string[];
  rows: string[][];
}

export interface CsvResult {
  ok: boolean;
  document?: CsvDocument;
  error?: string;
}

export interface UsbR485Api {
  loadCsv: (kind: CsvKind) => Promise<CsvResult>;
}
