import type { CsvDocument, CsvKind, UsbR485Api } from '../shared/types.js';
import type { ScanResult } from '../types/addresses.js';
import { formatFirmware } from '../hardware/transport.js';

declare global {
  interface Window {
    UsbR485: UsbR485Api;
  }
}

const status = document.querySelector<HTMLDivElement>('#status');
const fileTitle = document.querySelector<HTMLHeadingElement>('#file-title');
const table = document.querySelector<HTMLTableElement>('#csv-table');
const tbody = document.querySelector<HTMLTableSectionElement>('tbody');
const saveButton = document.querySelector<HTMLButtonElement>('#save-csv');
const scanButton = document.querySelector<HTMLButtonElement>('#scan-hardware');
const scanResults = document.querySelector<HTMLElement>('#scan-results');
const scanStatus = document.querySelector<HTMLDivElement>('#scan-status');
const scanTableBody = document.querySelector<HTMLTableSectionElement>('#scan-table tbody');
let currentDocument: CsvDocument | undefined;

if (!status || !fileTitle || !table || !tbody || !saveButton || !scanButton ||
  !scanResults || !scanStatus || !scanTableBody) {
  throw new Error('The application UI did not initialize.');
}

function renderScanResults(results: ScanResult[]): void {
  scanTableBody!.replaceChildren(...results.map((result) => {
    const row = document.createElement('tr');
    const values = [
      String(result.address),
      result.description,
      formatFirmware(result.expectedFirmware),
      result.connected ? formatFirmware(result.actualFirmware) : '—',
      result.connected ? 'Yes' : 'No',
      result.connected ? (result.firmwareMatch ? 'Yes' : 'No') : '—'
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    row.classList.toggle('scan-match', result.connected && result.firmwareMatch);
    row.classList.toggle('scan-mismatch', result.connected && !result.firmwareMatch);
    return row;
  }));
}

async function scanHardware(): Promise<void> {
  scanButton!.disabled = true;
  scanResults!.hidden = false;
  scanStatus!.classList.remove('error');
  scanStatus!.textContent = 'Scanning configured address range…';
  try {
    const response = await window.UsbR485.scanAddresses();
    if (!response.ok) throw new Error(response.error);
    renderScanResults(response.results);
    const connected = response.results.filter((result) => result.connected).length;
    const matches = response.results.filter((result) => result.firmwareMatch).length;
    scanStatus!.textContent =
      `${connected} connected; ${matches} firmware matches across ${response.results.length} addresses`;
  } catch (error) {
    scanTableBody!.replaceChildren();
    scanStatus!.textContent = error instanceof Error ? error.message : String(error);
    scanStatus!.classList.add('error');
  } finally {
    scanButton!.disabled = false;
  }
}

async function loadCsv(kind: CsvKind): Promise<void> {
  window.UsbR485.logStartupStage(`renderer-csv-load-started:${kind}`);
  status!.textContent = `Loading ${kind}…`;
  const result = await window.UsbR485.loadCsv(kind);
  if (!result.ok || !result.document) {
    table!.hidden = true;
    fileTitle!.textContent = kind;
    status!.textContent = result.error ?? 'Could not load the CSV file.';
    status!.classList.add('error');
    window.UsbR485.logStartupStage(`renderer-csv-load-failed:${kind}`);
    return;
  }

  currentDocument = result.document;
  render(result.document);
  window.UsbR485.logStartupStage(`renderer-csv-render-complete:${kind}`);
  status!.classList.remove('error');
  status!.textContent = `${result.document.rows.length.toLocaleString()} rows loaded — edit a cell, then save`;
  saveButton!.hidden = false;
}

function createEditableRow(values: string[], rowIndex: number): HTMLTableRowElement {
  const row = document.createElement('tr');
  values.forEach((value, columnIndex) => {
    const cell = document.createElement(rowIndex < 0 ? 'th' : 'td');
    const input = document.createElement('input');
    input.value = value;
    input.setAttribute('aria-label', rowIndex < 0 ? `Column ${columnIndex + 1}` : `Row ${rowIndex + 1}, column ${columnIndex + 1}`);
    cell.append(input);
    row.append(cell);
  });
  return row;
}

function render(csvDocument: CsvDocument): void {
  const head = table!.querySelector('thead');
  if (!head) throw new Error('The table head is missing.');
  head.replaceChildren(createEditableRow(csvDocument.headers, -1));
  tbody!.replaceChildren(...csvDocument.rows.map((row, index) => createEditableRow(row, index)));
  fileTitle!.textContent = csvDocument.kind;
  table!.hidden = false;
}

async function saveCsv(): Promise<void> {
  if (!currentDocument) return;
  const headInputs = table!.querySelectorAll<HTMLInputElement>('thead input');
  const rowElements = table!.querySelectorAll<HTMLTableRowElement>('tbody tr');
  const documentToSave: CsvDocument = {
    kind: currentDocument.kind,
    headers: [...headInputs].map((input) => input.value),
    rows: [...rowElements].map((row) => [...row.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value))
  };

  saveButton!.disabled = true;
  status!.textContent = 'Saving…';
  const result = await window.UsbR485.saveCsv(documentToSave);
  saveButton!.disabled = false;
  if (!result.ok) {
    status!.textContent = result.error;
    status!.classList.add('error');
    return;
  }

  currentDocument = documentToSave;
  status!.classList.remove('error');
  status!.textContent = `${documentToSave.kind} saved`;
}

saveButton!.addEventListener('click', () => { void saveCsv(); });
scanButton!.addEventListener('click', () => { void scanHardware(); });

document.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.csv as CsvKind | undefined;
    if (kind) void loadCsv(kind);
  });
});

window.UsbR485.logStartupStage('renderer-initialized');
