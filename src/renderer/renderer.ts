import type { CsvDocument, CsvKind } from '../shared/types.js';

declare global {
  interface Window {
    UsbR485: {
      loadCsv: (kind: CsvKind) => Promise<{ ok: boolean; document?: CsvDocument; error?: string }>;
      saveCsv: (document: CsvDocument) => Promise<{ ok: true } | { ok: false; error: string }>;
      logStartupStage: (stage: string) => void;
    };
  }
}

const status = document.querySelector<HTMLDivElement>('#status');
const fileTitle = document.querySelector<HTMLHeadingElement>('#file-title');
const table = document.querySelector<HTMLTableElement>('#csv-table');
const tbody = document.querySelector<HTMLTableSectionElement>('tbody');
const saveButton = document.querySelector<HTMLButtonElement>('#save-csv');
let currentDocument: CsvDocument | undefined;

if (!status || !fileTitle || !table || !tbody || !saveButton) {
  throw new Error('The application UI did not initialize.');
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

document.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.csv as CsvKind | undefined;
    if (kind) void loadCsv(kind);
  });
});

window.UsbR485.logStartupStage('renderer-initialized');
