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
const tbody = document.querySelector<HTMLTableSectionElement>('#csv-table tbody');
const saveButton = document.querySelector<HTMLButtonElement>('#save-csv');
const scanButton = document.querySelector<HTMLButtonElement>('#scan-hardware');
const serialInput = document.querySelector<HTMLInputElement>('#serial-number');
const operatorSelect = document.querySelector<HTMLSelectElement>('#operator-select');
const setupStatus = document.querySelector<HTMLDivElement>('#setup-status');
const scanResults = document.querySelector<HTMLElement>('#scan-results');
const scanStatus = document.querySelector<HTMLDivElement>('#scan-status');
const scanTableBody = document.querySelector<HTMLTableSectionElement>('#scan-table tbody');
let currentDocument: CsvDocument | undefined;
let scanSetupLoaded = false;
let scanInProgress = false;
let operatorSaveInProgress = false;
let operatorSaveSequence = 0;

if (!status || !fileTitle || !table || !tbody || !saveButton || !scanButton ||
  !serialInput || !operatorSelect || !setupStatus || !scanResults || !scanStatus || !scanTableBody) {
  throw new Error('The application UI did not initialize.');
}

function updateScanButton(): void {
  scanButton!.disabled = !scanSetupLoaded || scanInProgress || operatorSaveInProgress ||
    serialInput!.value.length !== 6 || operatorSelect!.value.length === 0;
}

function renderScanResults(results: ScanResult[]): void {
  const foundDevices = results.filter((result) => result.connected);
  scanTableBody!.replaceChildren(...foundDevices.map((result) => {
    const row = document.createElement('tr');
    for (const value of [
      String(result.address),
      result.description,
      formatFirmware(result.actualFirmware)
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }

    const statusCell = document.createElement('td');
    if (result.firmwareMatch) {
      statusCell.textContent = 'Firmware matches';
      row.classList.add('scan-match');
    } else {
      const warning = document.createElement('span');
      warning.className = 'warning-icon';
      warning.textContent = '⚠';
      warning.setAttribute('role', 'img');
      warning.setAttribute(
        'aria-label',
        `Firmware mismatch: expected ${formatFirmware(result.expectedFirmware)}`
      );
      statusCell.append(warning, document.createTextNode(
        ` Firmware mismatch (expected ${formatFirmware(result.expectedFirmware)})`
      ));
      row.classList.add('scan-mismatch');
    }
    row.append(statusCell);
    return row;
  }));

  scanStatus!.textContent = foundDevices.length === 0
    ? 'No hardware found.'
    : `${foundDevices.length} device${foundDevices.length === 1 ? '' : 's'} found.`;
}

async function loadScanSetup(): Promise<void> {
  setupStatus!.textContent = 'Loading operators…';
  setupStatus!.classList.remove('error');
  try {
    const response = await window.UsbR485.loadScanSetup();
    if (!response.ok) throw new Error(response.error);

    const options = [new Option('Select an operator', '')];
    for (const operator of response.operators) {
      options.push(new Option(operator, operator));
    }
    operatorSelect!.replaceChildren(...options);
    operatorSelect!.disabled = response.operators.length === 0;
    if (response.lastOperator) operatorSelect!.value = response.lastOperator;
    scanSetupLoaded = true;
    setupStatus!.textContent = response.operators.length === 0
      ? 'operator.csv contains no operators.'
      : '';
  } catch (error) {
    scanSetupLoaded = false;
    operatorSelect!.replaceChildren(new Option('Operators unavailable', ''));
    operatorSelect!.disabled = true;
    setupStatus!.textContent = error instanceof Error ? error.message : String(error);
    setupStatus!.classList.add('error');
  } finally {
    updateScanButton();
  }
}

async function persistSelectedOperator(): Promise<void> {
  const selectedOperator = operatorSelect!.value;
  const sequence = ++operatorSaveSequence;
  operatorSaveInProgress = true;
  operatorSelect!.disabled = true;
  setupStatus!.classList.remove('error');
  setupStatus!.textContent = '';
  updateScanButton();

  try {
    const result = await window.UsbR485.saveLastOperator(selectedOperator);
    if (sequence !== operatorSaveSequence) return;
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    if (sequence !== operatorSaveSequence) return;
    setupStatus!.textContent = error instanceof Error ? error.message : String(error);
    setupStatus!.classList.add('error');
  } finally {
    if (sequence === operatorSaveSequence) {
      operatorSaveInProgress = false;
      operatorSelect!.disabled = !scanSetupLoaded || operatorSelect!.options.length <= 1;
      updateScanButton();
    }
  }
}

async function scanHardware(): Promise<void> {
  if (serialInput!.value.length !== 6 || !operatorSelect!.value) return;
  scanInProgress = true;
  updateScanButton();
  scanButton!.disabled = true;
  scanResults!.hidden = false;
  scanStatus!.classList.remove('error');
  scanStatus!.textContent = 'Scanning hardware…';
  try {
    const response = await window.UsbR485.scanAddresses(
      serialInput!.value,
      operatorSelect!.value
    );
    if (!response.ok) throw new Error(response.error);
    renderScanResults(response.results);
  } catch (error) {
    scanTableBody!.replaceChildren();
    scanStatus!.textContent = error instanceof Error ? error.message : String(error);
    scanStatus!.classList.add('error');
  } finally {
    scanInProgress = false;
    updateScanButton();
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
serialInput!.addEventListener('input', updateScanButton);
operatorSelect!.addEventListener('change', () => { void persistSelectedOperator(); });

document.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.csv as CsvKind | undefined;
    if (kind) void loadCsv(kind);
  });
});

window.UsbR485.logStartupStage('renderer-initialized');
void loadScanSetup();
