import type { MotorAttemptResult, MotorTestRecord, ScanResult } from '../types/addresses.js';

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
export type MotorTestResponse =
  | { ok: true; result: MotorAttemptResult }
  | { ok: false; error: string };
export type TestReportResponse =
  | { ok: true; path: string; overall: 'passed' | 'failed' }
  | { ok: false; error: string };
export interface TestReportRequest {
  serialNumber: string;
  operator: string;
  records: MotorTestRecord[];
}

export type AuditAction =
  | 'scan'
  | 'csv_open_addresses'
  | 'csv_open_operators'
  | 'csv_save'
  | 'motor_run'
  | 'motor_rerun'
  | 'motor_ignore'
  | 'motor_stop'
  | 'report_save'
  | 'auto_jog_changed'
  | 'down_arrow_pressed'
  | 'down_arrow_released'
  | 'escape_pressed';

export interface AuditActionDetails {
  address?: number;
  enabled?: boolean;
}

export interface UsbR485Api {
  loadCsv: (kind: CsvKind) => Promise<CsvResult>;
  saveCsv: (document: CsvDocument) => Promise<CsvSaveResult>;
  loadScanSetup: () => Promise<ScanSetupResponse>;
  saveLastOperator: (operator: string) => Promise<CsvSaveResult>;
  scanAddresses: (serialNumber: string, operator: string) => Promise<ScanResponse>;
  runMotorTest: (address: number, autoJog: boolean) => Promise<MotorTestResponse>;
  cancelMotorTest: () => Promise<void>;
  setLimitJogging: (held: boolean) => Promise<void>;
  logActivity: (action: AuditAction, details?: AuditActionDetails) => Promise<void>;
  saveTestReport: (
    request: TestReportRequest
  ) => Promise<TestReportResponse>;
  logStartupStage: (stage: string) => void;
}
