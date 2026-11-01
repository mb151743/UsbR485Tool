import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, SimulatedDevice } from '../types/addresses.js';
import type { MotorAttemptResult, MotorTestRecord } from '../types/addresses.js';
import { SimTransport } from '../hardware/simTransport.js';
import type { Transport } from '../hardware/transport.js';
import type {
  AuditAction,
  AuditActionDetails,
  CsvDocument,
  CsvKind,
  CsvResult,
  CsvSaveResult,
  MotorTestResponse,
  ScanResponse,
  ScanSetupResponse,
  TestReportRequest,
  TestReportResponse
} from '../shared/types.js';
import { scanAddresses } from '../tests/scanner.js';
import { loadMotorTestPlans, runMotorTest } from '../tests/motors.js';
import { readCsv, writeCsv } from './csv.js';

const processStartedAt = process.hrtime.bigint();
const startupRunId = new Date().toISOString();
const pendingStartupLog: string[] = [];
let startupLogPath: string | undefined;
let startupLogWriteQueue = Promise.resolve();
let activeMotorTest: AbortController | undefined;
let limitJoggingHeld = false;
let activityLogPathPromise: Promise<string> | undefined;
let activityLogWriteQueue = Promise.resolve();

async function activityLogPath(): Promise<string> {
  if (!activityLogPathPromise) {
    activityLogPathPromise = (async () => {
      const directory = path.join(externalCsvDirectory(), 'TestData');
      await mkdir(directory, { recursive: true });
      return path.join(directory, 'activity.log');
    })();
  }
  return activityLogPathPromise;
}

async function writeActivityLog(
  event: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details
  })}\r\n`;
  const operation = activityLogWriteQueue.then(async () => {
    await appendFile(await activityLogPath(), line, 'utf8');
  });
  activityLogWriteQueue = operation.catch(() => undefined);
  await operation;
}

function auditedTransport(transport: Transport): Transport {
  return {
    async sendCommand(address, command, data1, data2) {
      await writeActivityLog('COMMAND_TX', { address, command, data1, data2 });
      try {
        const response = await transport.sendCommand(address, command, data1, data2);
        await writeActivityLog('COMMAND_RX', {
          address: response.address,
          command: response.command,
          data1: response.data1,
          data2: response.data2
        });
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeActivityLog('COMMAND_ERROR', {
          address,
          command,
          error: message
        });
        throw error;
      }
    }
  };
}

const AUDIT_ACTIONS: readonly AuditAction[] = [
  'scan',
  'csv_open_addresses',
  'csv_open_operators',
  'csv_save',
  'motor_run',
  'motor_rerun',
  'motor_ignore',
  'motor_stop',
  'report_save',
  'auto_jog_changed',
  'down_arrow_pressed',
  'down_arrow_released',
  'escape_pressed'
];

async function recordUserAction(request: unknown): Promise<void> {
  if (!isRecord(request) || typeof request.action !== 'string' ||
    !AUDIT_ACTIONS.includes(request.action as AuditAction)) {
    throw new Error('Invalid activity log action.');
  }
  const details = request.details;
  if (details !== undefined && !isRecord(details)) {
    throw new Error('Invalid activity log details.');
  }
  const cleanDetails: AuditActionDetails = {};
  if (details) {
    if (details.address !== undefined) {
      if (!isIntegerInRange(details.address, 0, 255)) {
        throw new Error('Activity log address must be from 0 to 255.');
      }
      cleanDetails.address = details.address;
    }
    if (details.enabled !== undefined) {
      if (typeof details.enabled !== 'boolean') {
        throw new Error('Activity log enabled state must be true or false.');
      }
      cleanDetails.enabled = details.enabled;
    }
  }
  await writeActivityLog('USER_ACTION', {
    action: request.action,
    ...cleanDetails
  });
}

function logStartupStage(stage: string, details?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    runId: startupRunId,
    elapsedMs: Number(process.hrtime.bigint() - processStartedAt) / 1_000_000,
    stage,
    ...(details ? { details } : {})
  };
  const line = `${JSON.stringify(entry)}\r\n`;

  const logPath = startupLogPath;
  if (!logPath) {
    pendingStartupLog.push(line);
    return;
  }

  startupLogWriteQueue = startupLogWriteQueue
    .then(() => appendFile(logPath, line, 'utf8'))
    .catch((error: unknown) => {
      console.error('Could not write startup log:', error);
    });
}

logStartupStage('process-start');

async function initializeStartupLog(): Promise<void> {
  try {
    const logPath = path.join(app.getPath('userData'), 'startup.log');
    await mkdir(path.dirname(logPath), { recursive: true });
    let existingSize = 0;
    try {
      existingSize = (await stat(logPath)).size;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (existingSize > 1024 * 1024) {
      await writeFile(logPath, '', 'utf8');
      logStartupStage('startup-log-rotated');
    }
    await appendFile(logPath, pendingStartupLog.join(''), 'utf8');
    startupLogPath = logPath;
    pendingStartupLog.length = 0;
    logStartupStage('startup-log-initialized', { path: logPath });
  } catch (error) {
    startupLogPath = undefined;
    console.error('Could not initialize startup log:', error);
  }
}

function externalCsvDirectory(): string {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
  }
  return app.getAppPath();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

async function loadAppConfig(): Promise<AppConfig> {
  const configPath = path.join(externalCsvDirectory(), 'config.json');
  const content = await readFile(configPath, 'utf8');
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error('config.json must contain a JSON object.');
  if (parsed.transport !== 'simulation' && parsed.transport !== 'ftdi') {
    throw new Error('config.json transport must be "simulation" or "ftdi".');
  }
  if (!isRecord(parsed.addressRange)) {
    throw new Error('config.json must define an addressRange object.');
  }
  const { start, end } = parsed.addressRange;
  if (!isIntegerInRange(start, 0, 255) || !isIntegerInRange(end, 0, 255) || start > end) {
    throw new Error('config.json addressRange must be an ascending range from 0 to 255.');
  }
  const configuredLastOperator = parsed.lastOperator;
  if (configuredLastOperator !== undefined && typeof configuredLastOperator !== 'string') {
    throw new Error('config.json lastOperator must be a string.');
  }
  const lastOperator = configuredLastOperator ?? '';
  if (!isRecord(parsed.simulation) || !Array.isArray(parsed.simulation.devices)) {
    throw new Error('config.json simulation.devices must be an array.');
  }

  const devices: SimulatedDevice[] = parsed.simulation.devices.map((value, index) => {
    if (
      !isRecord(value) ||
      !isIntegerInRange(value.address, 0, 255) ||
      !isIntegerInRange(value.firmwareMajor, 0, 255) ||
      !isIntegerInRange(value.firmwareMinor, 0, 99)
    ) {
      throw new Error(`config.json simulation.devices[${index}] has invalid address or firmware values.`);
    }
    return {
      address: value.address,
      firmwareMajor: value.firmwareMajor,
      firmwareMinor: value.firmwareMinor
    };
  });

  return {
    transport: parsed.transport,
    addressRange: { start, end },
    simulation: { devices },
    lastOperator
  };
}

async function loadOperators(): Promise<string[]> {
  const operatorPath = path.join(externalCsvDirectory(), 'operator.csv');
  if (!existsSync(operatorPath)) throw new Error('Could not find operator.csv beside the executable.');
  const document = await readCsv(operatorPath, 'operator.csv');
  return [...new Set(document.rows
    .map((row) => row.map((field) => field.trim()).filter(Boolean).join(' '))
    .filter((operator) => operator.length > 0))];
}

async function persistLastOperator(operator: string): Promise<void> {
  const configPath = path.join(externalCsvDirectory(), 'config.json');
  const content = await readFile(configPath, 'utf8');
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error('config.json must contain a JSON object.');
  await writeFile(configPath, `${JSON.stringify({ ...parsed, lastOperator: operator }, null, 2)}\n`, 'utf8');
}

async function loadScanSetup(): Promise<ScanSetupResponse> {
  try {
    const [config, operators] = await Promise.all([loadAppConfig(), loadOperators()]);
    return {
      ok: true,
      operators,
      lastOperator: operators.includes(config.lastOperator) ? config.lastOperator : ''
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function saveLastOperator(operator: unknown): Promise<CsvSaveResult> {
  try {
    if (typeof operator !== 'string') throw new Error('Choose an operator from the list.');
    const operators = await loadOperators();
    if (!operators.includes(operator)) throw new Error('Choose an operator from the list.');
    await persistLastOperator(operator);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runAddressScan(serialNumber: unknown, operator: unknown): Promise<ScanResponse> {
  try {
    if (typeof serialNumber !== 'string' || serialNumber.length !== 6) {
      throw new Error('Serial number must be exactly 6 characters.');
    }
    if (typeof operator !== 'string') throw new Error('Choose an operator from the list.');
    const operators = await loadOperators();
    if (!operators.includes(operator)) throw new Error('Choose an operator from the list.');

    const config = await loadAppConfig();
    await persistLastOperator(operator);
    if (config.transport === 'ftdi') {
      throw new Error(
        'FTDI mode is selected, but no D2XX device adapter is installed. ' +
        'Connect a D2xxDevice adapter to FtdiTransport in the main process.'
      );
    }
    const transport = auditedTransport(new SimTransport(config.simulation.devices));
    const results = await scanAddresses(
      transport,
      path.join(externalCsvDirectory(), 'Addresses.csv'),
      config.addressRange
    );
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runConfiguredMotorTest(request: unknown): Promise<MotorTestResponse> {
  let controller: AbortController | undefined;
  try {
    if (!isRecord(request) || typeof request.autoJog !== 'boolean') {
      throw new Error('Motor test request must include an auto-jog setting.');
    }
    const addressValue = request.address;
    if (!isIntegerInRange(addressValue, 0, 255)) {
      throw new Error('Choose a valid motor address.');
    }
    const autoJog = request.autoJog;
    if (activeMotorTest) throw new Error('A motor test is already running.');
    controller = new AbortController();
    activeMotorTest = controller;

    const config = await loadAppConfig();
    if (config.transport === 'ftdi') {
      throw new Error(
        'FTDI mode is selected, but no D2XX device adapter is installed. ' +
        'No motor command was sent.'
      );
    }

    const csvPath = path.join(externalCsvDirectory(), 'Addresses.csv');
    const plans = await loadMotorTestPlans(csvPath);
    const plan = plans.get(addressValue);
    if (!plan) throw new Error(`Address ${addressValue} is not configured for a motor test.`);

    const transport = auditedTransport(new SimTransport(config.simulation.devices));
    const firmwareResponse = await transport.sendCommand(addressValue, 137, 0, 0);
    if (firmwareResponse.address !== addressValue || firmwareResponse.command !== 137) {
      throw new Error(`Address ${addressValue} did not return a valid firmware response.`);
    }

    const addressCsv = await readCsv(csvPath, 'Addresses.csv');
    const headers = addressCsv.headers.map((header) =>
      header.toLowerCase().replace(/[^a-z0-9]/g, '')
    );
    const addressColumn = headers.indexOf('address');
    const descriptionColumn = headers.indexOf('description');
    const row = addressCsv.rows.find((candidate) =>
      Number(candidate[addressColumn]) === addressValue
    );
    const description = row?.[descriptionColumn]?.trim() || `Address ${addressValue}`;

    if (config.transport === 'simulation' && plan.switchChecks.length > 0) {
      return {
        ok: true,
        result: {
          passed: false,
          error: `${description}: limit-switch checks cannot be verified in simulation.`
        }
      };
    }
    if (controller.signal.aborted) {
      throw new Error('Motor test was stopped before it could start.');
    }
    limitJoggingHeld = false;
    const result = await runMotorTest(
      transport,
      addressValue,
      description,
      plan,
      controller.signal,
      () => limitJoggingHeld,
      autoJog
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (activeMotorTest === controller) {
      activeMotorTest = undefined;
      limitJoggingHeld = false;
    }
  }
}

function cancelConfiguredMotorTest(): void {
  limitJoggingHeld = false;
  activeMotorTest?.abort();
}

function setConfiguredLimitJogging(held: unknown): void {
  if (typeof held !== 'boolean') throw new Error('Limit-jog input must be true or false.');
  if (!activeMotorTest) return;
  limitJoggingHeld = held;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isMotorAttemptResult(value: unknown): value is MotorAttemptResult {
  return isRecord(value) &&
    typeof value.passed === 'boolean' &&
    (value.passed || typeof value.error === 'string');
}

function isMotorTestRecord(value: unknown): value is MotorTestRecord {
  if (!isRecord(value) ||
    !isIntegerInRange(value.address, 0, 255) ||
    typeof value.description !== 'string' ||
    !['passed', 'failed', 'ignored', 'not-tested'].includes(String(value.status)) ||
    !Array.isArray(value.attempts)) {
    return false;
  }
  const attempts = value.attempts.filter(isMotorAttemptResult);
  if (attempts.length !== value.attempts.length) return false;
  if (value.status === 'passed') return attempts.some((attempt) => attempt.passed);
  if (value.status === 'failed') return attempts.length > 0 && !attempts.at(-1)?.passed;
  if (value.status === 'ignored') return attempts.length > 0 && !attempts.at(-1)?.passed;
  return attempts.length === 0;
}

function isTestReportRequest(value: unknown): value is TestReportRequest {
  if (!isRecord(value) ||
    typeof value.serialNumber !== 'string' ||
    value.serialNumber.length !== 6 ||
    typeof value.operator !== 'string' ||
    !Array.isArray(value.records)) {
    return false;
  }
  const addresses = new Set<number>();
  return value.records.every((record: unknown) => {
    if (!isMotorTestRecord(record) || addresses.has(record.address)) return false;
    addresses.add(record.address);
    return true;
  });
}

async function saveTestReport(requestValue: unknown): Promise<TestReportResponse> {
  try {
    if (!isTestReportRequest(requestValue)) {
      throw new Error('The test report contains invalid or incomplete data.');
    }
    const { serialNumber, operator, records } = requestValue;
    const operators = await loadOperators();
    if (!operators.includes(operator)) throw new Error('Choose a valid operator before saving the report.');
    if (records.length === 0) throw new Error('There are no motor results to report.');
    if (records.some((record) =>
      record.status === 'failed' || record.status === 'not-tested'
    )) {
      throw new Error('Rerun or ignore every failed motor test before saving the report.');
    }

    const overall: 'passed' | 'failed' = records.some((record) =>
      record.status === 'passed'
    ) && records.every((record) =>
      record.status === 'passed' || record.status === 'ignored'
    ) ? 'passed' : 'failed';
    const lines = [
      'inVia Pre-System Test',
      'Transport mode: SIMULATION (does not verify physical motor movement)',
      `System serial number: ${oneLine(serialNumber)}`,
      `Operator: ${oneLine(operator)}`,
      `Report generated: ${new Date().toISOString()}`,
      '',
      'Motor results:'
    ];
    for (const record of records) {
      lines.push(
        `${record.address} - ${oneLine(record.description)}: ${record.status.toUpperCase()}`
      );
      record.attempts.forEach((attempt, index) => {
        lines.push(attempt.passed
          ? `  Attempt ${index + 1}: PASS`
          : `  Attempt ${index + 1}: FAIL - ${oneLine(attempt.error)}`);
      });
    }
    lines.push('', `Overall result: ${overall.toUpperCase()}`);

    const outputDirectory = path.join(externalCsvDirectory(), 'TestData');
    await mkdir(outputDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeSerial = serialNumber.replace(/[^A-Za-z0-9_-]/g, '_');
    const reportPath = path.join(
      outputDirectory,
      `${safeSerial}-${timestamp}-test-report.txt`
    );
    await writeFile(reportPath, `${lines.join('\r\n')}\r\n`, 'utf8');
    return { ok: true, path: reportPath, overall };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadCsv(kind: CsvKind): Promise<CsvResult> {
  const csvPath = path.join(externalCsvDirectory(), kind);
  const loadStartedAt = process.hrtime.bigint();
  logStartupStage('csv-load-started', { kind });
  try {
    if (!existsSync(csvPath)) throw new Error(`Could not find ${kind} beside the executable.`);
    const document = await readCsv(csvPath, kind);
    logStartupStage('csv-load-completed', {
      kind,
      rows: document.rows.length,
      durationMs: Number(process.hrtime.bigint() - loadStartedAt) / 1_000_000
    });
    return { ok: true, document };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStartupStage('csv-load-failed', {
      kind,
      durationMs: Number(process.hrtime.bigint() - loadStartedAt) / 1_000_000,
      error: message
    });
    return { ok: false, error: message };
  }
}

function createWindow(): void {
  logStartupStage('window-creation-started');
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#f5f3ef',
    title: 'USB-RS485 Command Tool',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  logStartupStage('window-created');
  window.webContents.on('did-start-loading', () => logStartupStage('window-load-started'));
  window.webContents.on('dom-ready', () => logStartupStage('window-dom-ready'));
  window.webContents.on('did-finish-load', () => logStartupStage('window-load-finished'));
  window.webContents.on('render-process-gone', (_event, details) => {
    logStartupStage('renderer-process-gone', { reason: details.reason, exitCode: details.exitCode });
  });
  logStartupStage('window-load-file-requested');
  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((error: unknown) => {
    logStartupStage('window-load-failed', { error: error instanceof Error ? error.message : String(error) });
    console.error('Could not load application window:', error);
  });
}

async function saveCsv(document: CsvDocument): Promise<CsvSaveResult> {
  const csvPath = path.join(externalCsvDirectory(), document.kind);
  try {
    await writeCsv(csvPath, document);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

Menu.setApplicationMenu(null);
ipcMain.handle('csv:load', (_event, kind: CsvKind) => loadCsv(kind));
ipcMain.handle('csv:save', (_event, document: CsvDocument) => saveCsv(document));
ipcMain.handle('hardware:setup', () => loadScanSetup());
ipcMain.handle('hardware:save-operator', (_event, operator: unknown) => saveLastOperator(operator));
ipcMain.handle('hardware:scan', (_event, request: unknown) => {
  if (!isRecord(request)) return runAddressScan(undefined, undefined);
  return runAddressScan(request.serialNumber, request.operator);
});
ipcMain.handle('hardware:run-motor-test', (_event, address: unknown) =>
  runConfiguredMotorTest(address)
);
ipcMain.handle('hardware:cancel-motor-test', () => cancelConfiguredMotorTest());
ipcMain.handle('hardware:set-limit-jogging', (_event, held: unknown) =>
  setConfiguredLimitJogging(held)
);
ipcMain.handle('audit:activity', (_event, request: unknown) => recordUserAction(request));
ipcMain.handle('report:save-test-report', (_event, request: unknown) =>
  saveTestReport(request)
);
ipcMain.on('startup:log', (_event, stage: unknown) => {
  if (typeof stage === 'string' && /^[a-z0-9:._-]{1,80}$/i.test(stage)) {
    logStartupStage(stage);
  }
});

void app.whenReady().then(() => {
  void initializeStartupLog().then(() => {
    logStartupStage('app-ready');
    createWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
