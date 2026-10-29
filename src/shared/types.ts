import type { ScanResult } from '../types/addresses.js';

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

export type CsvSaveResult = { ok: true } | { ok: false; error: string };
export type ScanSetupResponse =
  | { ok: true; operators: string[]; lastOperator: string }
  | { ok: false; error: string };
export type ScanResponse =
  | { ok: true; results: ScanResult[] }
  | { ok: false; error: string };

export interface UsbR485Api {
  loadCsv: (kind: CsvKind) => Promise<CsvResult>;
  saveCsv: (document: CsvDocument) => Promise<CsvSaveResult>;
  loadScanSetup: () => Promise<ScanSetupResponse>;
  saveLastOperator: (operator: string) => Promise<CsvSaveResult>;
  scanAddresses: (serialNumber: string, operator: string) => Promise<ScanResponse>;
  logStartupStage: (stage: string) => void;
}
