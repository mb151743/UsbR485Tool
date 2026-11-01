import type { AuditAction, AuditActionDetails, CsvDocument, CsvKind, UsbR485Api } from '../shared/types.js';
import type { ScanResult } from '../types/addresses.js';
import type { MotorTestRecord } from '../types/addresses.js';
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
const motorWorkflow = document.querySelector<HTMLElement>('#motor-workflow');
const motorTableBody = document.querySelector<HTMLTableSectionElement>('#motor-table tbody');
const motorStatus = document.querySelector<HTMLDivElement>('#motor-status');
const cancelMotorButton = document.querySelector<HTMLButtonElement>('#cancel-motor-test');
const reportButton = document.querySelector<HTMLButtonElement>('#save-test-report');
const autoJogCheckbox = document.querySelector<HTMLInputElement>('#auto-jog');
const usbDeviceStatus = document.querySelector<HTMLSpanElement>('#usb-device-status');
const d2xxDeviceStatus = document.querySelector<HTMLSpanElement>('#d2xx-device-status');
let currentDocument: CsvDocument | undefined;
let scanSetupLoaded = false;
let scanInProgress = false;
let operatorSaveInProgress = false;
let operatorSaveSequence = 0;
let motorTestResults: ScanResult[] = [];
let motorRecords = new Map<number, MotorTestRecord>();
let motorTestInProgress = false;
let reportInProgress = false;
let scanIdentity: { serialNumber: string; operator: string } | undefined;
let activeMotorSupportsJogging = false;
let limitJoggingHeld = false;
let downArrowPressed = false;
let usbDetectionInProgress = false;

if (!status || !fileTitle || !table || !tbody || !saveButton || !scanButton ||
  !serialInput || !operatorSelect || !setupStatus || !scanResults || !scanStatus || !scanTableBody ||
  !motorWorkflow || !motorTableBody || !motorStatus || !cancelMotorButton || !reportButton ||
  !autoJogCheckbox || !usbDeviceStatus || !d2xxDeviceStatus) {
  throw new Error('The application UI did not initialize.');
}

async function refreshUsbDeviceStatus(): Promise<void> {
  if (usbDetectionInProgress) return;
  usbDetectionInProgress = true;
  usbDeviceStatus!.classList.remove('error');
  d2xxDeviceStatus!.classList.remove('error');
  try {
    const [pnpResult, d2xxResult] = await Promise.all([
      window.UsbR485.detectUsbDevices(),
      window.UsbR485.detectD2xxDevices()
    ]);
    if (!pnpResult.ok) {
      usbDeviceStatus!.textContent = `PnP detection unavailable: ${pnpResult.error}`;
      usbDeviceStatus!.classList.add('error');
    } else {
      const knownDevices = ['RA802', 'SEMSCA', 'MSC20'] as const;
      const detected = new Set(pnpResult.devices);
      usbDeviceStatus!.textContent = knownDevices
        .map((device) => `${device}: ${detected.has(device) ? 'Detected' : 'Not detected'}`)
        .join(' · ');
    }
    if (!d2xxResult.ok) {
      d2xxDeviceStatus!.textContent = `D2XX unavailable: ${d2xxResult.error}`;
      d2xxDeviceStatus!.classList.add('error');
    } else {
      const devices = d2xxResult.devices.length > 0
        ? d2xxResult.devices.join(', ')
        : 'No FTDI devices enumerated';
      d2xxDeviceStatus!.textContent = `D2XX ready (${d2xxResult.libraryPath}): ${devices}`;
    }
  } catch (error) {
    usbDeviceStatus!.textContent =
      `Detection unavailable: ${error instanceof Error ? error.message : String(error)}`;
    usbDeviceStatus!.classList.add('error');
  } finally {
    usbDetectionInProgress = false;
  }
}

async function logUserAction(
  action: AuditAction,
  details?: AuditActionDetails
): Promise<boolean> {
  try {
    await window.UsbR485.logActivity(action, details);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const visibleStatus = motorWorkflow!.hidden ? status! : motorStatus!;
    visibleStatus.textContent = `Could not write activity log: ${message}`;
    visibleStatus.classList.add('error');
    return false;
  }
}

function updateScanButton(): void {
  scanButton!.disabled = !scanSetupLoaded || scanInProgress || operatorSaveInProgress || motorTestInProgress ||
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

function updateReportButton(): void {
  const records = [...motorRecords.values()];
  reportButton!.disabled = reportInProgress || motorTestInProgress || !scanIdentity ||
    scanIdentity.serialNumber !== serialInput!.value ||
    scanIdentity.operator !== operatorSelect!.value || records.length === 0 ||
    records.some((record) => record.status === 'failed' || record.status === 'not-tested');
}

function invalidateScanIfInputsChanged(): void {
  if (!scanIdentity || (
    scanIdentity.serialNumber === serialInput!.value &&
    scanIdentity.operator === operatorSelect!.value
  )) return;
  scanIdentity = undefined;
  motorTestResults = [];
  motorRecords.clear();
  motorWorkflow!.hidden = true;
  scanResults!.hidden = true;
  motorStatus!.textContent = 'Setup changed. Scan hardware again before testing or saving results.';
  updateReportButton();
}

function renderMotorTests(results: ScanResult[]): void {
  motorTestResults = results.filter((result) => result.connected && result.motorTest !== undefined);
  motorRecords = new Map(motorTestResults.map((result) => [result.address, {
    address: result.address,
    description: result.description,
    status: 'not-tested',
    attempts: []
  }]));
  motorWorkflow!.hidden = true;
  motorTableBody!.replaceChildren();
  cancelMotorButton!.hidden = true;
  motorStatus!.classList.remove('error');

  if (motorTestResults.length === 0) {
    motorStatus!.textContent = 'No connected devices are configured for motor tests.';
    return;
  }
  motorWorkflow!.hidden = false;
  motorStatus!.textContent = 'Run each configured motor test. Failed motors can be rerun or ignored.';
  renderMotorRows();
}

function renderMotorRows(): void {
  motorTableBody!.replaceChildren(...motorTestResults.map((device) => {
    const row = document.createElement('tr');
    const record = motorRecords.get(device.address);
    if (!record || !device.motorTest) throw new Error('Motor test state is incomplete.');

    for (const value of [
      String(device.address),
      device.description,
      [
        ...(device.motorTest.reference ? ['Reference'] : []),
        ...device.motorTest.targets.map((target) => `${target.label}: ${target.position}`),
        ...device.motorTest.switchChecks.map((check) =>
          `${check.label}: ${check.move} (hold Down Arrow)`
        )
      ].join(', ') || 'No steps'
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }

    const resultCell = document.createElement('td');
    resultCell.textContent = record.status === 'not-tested'
      ? 'Not tested'
      : record.status.toUpperCase();
    resultCell.className = `motor-${record.status}`;
    row.append(resultCell);

    const actionCell = document.createElement('td');
    if (record.status === 'not-tested' || record.status === 'failed') {
      const runButton = document.createElement('button');
      runButton.className = 'button small primary';
      runButton.type = 'button';
      runButton.textContent = record.status === 'failed' ? 'Rerun' : 'Run test';
      runButton.disabled = motorTestInProgress;
      runButton.addEventListener('click', () => {
        void runMotor(device.address, record.status === 'failed' ? 'motor_rerun' : 'motor_run');
      });
      actionCell.append(runButton);
    }
    if (record.status === 'failed') {
      const ignoreButton = document.createElement('button');
      ignoreButton.className = 'button small secondary';
      ignoreButton.type = 'button';
      ignoreButton.textContent = 'Ignore';
      ignoreButton.disabled = motorTestInProgress;
      ignoreButton.addEventListener('click', () => { void ignoreMotor(device.address); });
      actionCell.append(ignoreButton);
    }
    row.append(actionCell);
    return row;
  }));
  updateReportButton();
}

async function runMotor(address: number, action: 'motor_run' | 'motor_rerun'): Promise<void> {
  const record = motorRecords.get(address);
  const device = motorTestResults.find((result) => result.address === address);
  if (!record || motorTestInProgress || !scanIdentity ||
    !device?.motorTest || scanIdentity.serialNumber !== serialInput!.value ||
    scanIdentity.operator !== operatorSelect!.value) return;
  if (!await logUserAction(action, {
    address,
    enabled: autoJogCheckbox!.checked
  })) return;
  motorTestInProgress = true;
  activeMotorSupportsJogging = device.motorTest.switchChecks.length > 0;
  limitJoggingHeld = false;
  downArrowPressed = false;
  serialInput!.disabled = true;
  operatorSelect!.disabled = true;
  autoJogCheckbox!.disabled = true;
  cancelMotorButton!.hidden = false;
  motorStatus!.classList.remove('error');
  motorStatus!.textContent = activeMotorSupportsJogging
    ? `Testing ${record.description}… Hold Down Arrow during a limit-switch check; release it to stop jogging.`
    : `Testing ${record.description}…`;
  updateScanButton();
  renderMotorRows();
  try {
    const response = await window.UsbR485.runMotorTest(address, autoJogCheckbox!.checked);
    const result = response.ok
      ? response.result
      : { passed: false as const, error: response.error };
    record.attempts.push(result);
    record.status = result.passed ? 'passed' : 'failed';
    motorStatus!.textContent = result.passed
      ? `${record.description} passed.`
      : `${record.description} failed: ${result.error}`;
    if (!result.passed) motorStatus!.classList.add('error');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record.attempts.push({ passed: false, error: message });
    record.status = 'failed';
    motorStatus!.textContent = `${record.description} failed: ${message}`;
    motorStatus!.classList.add('error');
  } finally {
    if (limitJoggingHeld) await updateLimitJogging(false);
    motorTestInProgress = false;
    activeMotorSupportsJogging = false;
    serialInput!.disabled = false;
    operatorSelect!.disabled = !scanSetupLoaded || operatorSelect!.options.length <= 1;
    autoJogCheckbox!.disabled = false;
    cancelMotorButton!.hidden = true;
    updateScanButton();
    renderMotorRows();
  }
}

async function ignoreMotor(address: number): Promise<void> {
  const record = motorRecords.get(address);
  if (!record || record.status !== 'failed') return;
  if (!await logUserAction('motor_ignore', { address })) return;
  record.status = 'ignored';
  motorStatus!.classList.remove('error');
  motorStatus!.textContent = `${record.description} marked ignored.`;
  renderMotorRows();
}

async function cancelMotorTest(): Promise<void> {
  cancelMotorButton!.disabled = true;
  try {
    const logged = await logUserAction('motor_stop');
    await window.UsbR485.cancelMotorTest();
    if (!logged) motorStatus!.textContent += ' Motor stopped; activity log write failed.';
  } finally {
    cancelMotorButton!.disabled = false;
  }
}

async function updateLimitJogging(held: boolean): Promise<void> {
  if (!motorTestInProgress || !activeMotorSupportsJogging || limitJoggingHeld === held) return;
  limitJoggingHeld = held;
  try {
    await window.UsbR485.setLimitJogging(held);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    motorStatus!.textContent = `Could not update limit-jog input: ${message}`;
    motorStatus!.classList.add('error');
    if (held) await cancelMotorTest();
  }
}

async function saveTestReport(): Promise<void> {
  if (reportButton!.disabled || !scanIdentity) return;
  if (!await logUserAction('report_save')) return;
  reportInProgress = true;
  updateReportButton();
  motorStatus!.classList.remove('error');
  motorStatus!.textContent = 'Saving test report…';
  try {
    const response = await window.UsbR485.saveTestReport({
      serialNumber: scanIdentity.serialNumber,
      operator: scanIdentity.operator,
      records: [...motorRecords.values()]
    });
    if (!response.ok) throw new Error(response.error);
    motorStatus!.textContent = `Overall ${response.overall.toUpperCase()}. Report saved to ${response.path}`;
    reportButton!.disabled = true;
  } catch (error) {
    motorStatus!.textContent = error instanceof Error ? error.message : String(error);
    motorStatus!.classList.add('error');
  } finally {
    reportInProgress = false;
    updateReportButton();
  }
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
  scanIdentity = undefined;
  motorWorkflow!.hidden = true;
  scanResults!.hidden = true;
  motorRecords.clear();
  updateReportButton();
  scanInProgress = true;
  serialInput!.disabled = true;
  operatorSelect!.disabled = true;
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
    scanIdentity = {
      serialNumber: serialInput!.value,
      operator: operatorSelect!.value
    };
    scanResults!.hidden = false;
    renderScanResults(response.results);
    renderMotorTests(response.results);
  } catch (error) {
    scanTableBody!.replaceChildren();
    renderMotorTests([]);
    scanResults!.hidden = false;
    scanStatus!.textContent = error instanceof Error ? error.message : String(error);
    scanStatus!.classList.add('error');
  } finally {
    scanInProgress = false;
    serialInput!.disabled = false;
    operatorSelect!.disabled = !scanSetupLoaded || operatorSelect!.options.length <= 1;
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
  if (!await logUserAction('csv_save')) return;
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
scanButton!.addEventListener('click', async () => {
  if (await logUserAction('scan')) await scanHardware();
});
cancelMotorButton!.addEventListener('click', () => { void cancelMotorTest(); });
reportButton!.addEventListener('click', () => { void saveTestReport(); });
serialInput!.addEventListener('input', invalidateScanIfInputsChanged);
operatorSelect!.addEventListener('change', invalidateScanIfInputsChanged);
serialInput!.addEventListener('input', updateScanButton);
operatorSelect!.addEventListener('change', () => { void persistSelectedOperator(); });

document.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.csv as CsvKind | undefined;
    if (kind) {
      const action = kind === 'Addresses.csv' ? 'csv_open_addresses' : 'csv_open_operators';
      void logUserAction(action).then((logged) => {
        if (logged) void loadCsv(kind);
      });
    }
  });
});

window.UsbR485.logStartupStage('renderer-initialized');
void loadScanSetup();
void refreshUsbDeviceStatus();
window.setInterval(() => { void refreshUsbDeviceStatus(); }, 5000);
window.addEventListener('focus', () => { void refreshUsbDeviceStatus(); });

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' && activeMotorSupportsJogging && !event.repeat && !downArrowPressed) {
    event.preventDefault();
    downArrowPressed = true;
    void logUserAction('down_arrow_pressed').then((logged) => {
      if (logged && downArrowPressed) void updateLimitJogging(true);
      else void cancelMotorTest();
    });
  } else if (event.key === 'Escape' && motorTestInProgress) {
    event.preventDefault();
    void logUserAction('escape_pressed').then(() => cancelMotorTest());
  }
});
window.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowDown' && downArrowPressed) {
    downArrowPressed = false;
    if (limitJoggingHeld) {
      void logUserAction('down_arrow_released').then(() => updateLimitJogging(false));
    }
  }
});
window.addEventListener('blur', () => {
  if (downArrowPressed) {
    downArrowPressed = false;
    if (limitJoggingHeld) {
      void logUserAction('down_arrow_released').then(() => updateLimitJogging(false));
    }
  }
});

autoJogCheckbox!.addEventListener('change', () => {
  void logUserAction('auto_jog_changed', { enabled: autoJogCheckbox!.checked }).then((logged) => {
    if (!logged) autoJogCheckbox!.checked = false;
  });
});
