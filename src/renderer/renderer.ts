import type { CsvDocument, CsvKind } from '../shared/types.js';

declare global {
  interface Window {
    UsbR485: {
      loadCsv: (kind: CsvKind) => Promise<{ ok: boolean; document?: CsvDocument; error?: string }>;
    };
  }
}

const status = document.querySelector<HTMLDivElement>('#status');
const fileTitle = document.querySelector<HTMLHeadingElement>('#file-title');
const table = document.querySelector<HTMLTableElement>('#csv-table');
const tbody = document.querySelector<HTMLTableSectionElement>('tbody');

if (!status || !fileTitle || !table || !tbody) {
  throw new Error('The application UI did not initialize.');
}

async function loadCsv(kind: CsvKind): Promise<void> {
  status!.textContent = `Loading ${kind}…`;
  const result = await window.UsbR485.loadCsv(kind);
  if (!result.ok || !result.document) {
    table!.hidden = true;
    fileTitle!.textContent = kind;
    status!.textContent = result.error ?? 'Could not load the CSV file.';
    status!.classList.add('error');
    return;
  }

  render(result.document);
  status!.classList.remove('error');
  status!.textContent = `${result.document.rows.length.toLocaleString()} rows loaded`;
}

function render(document: CsvDocument): void {
  const head = table!.querySelector('thead');
  if (!head) throw new Error('The table head is missing.');
  head.replaceChildren(createHeader(document.headers));
  tbody!.replaceChildren(...document.rows.map(createRow));
  fileTitle!.textContent = document.kind;
  table!.hidden = false;
}

function createHeader(headers: string[]): HTMLTableRowElement {
  const row = document.createElement('tr');
  headers.forEach((header) => {
    const cell = document.createElement('th');
    cell.textContent = header;
    row.append(cell);
  });
  return row;
}

function createRow(values: string[]): HTMLTableRowElement {
  const row = document.createElement('tr');
  values.forEach((value) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  });
  return row;
}

document.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.csv as CsvKind | undefined;
    if (kind) void loadCsv(kind);
  });
});
