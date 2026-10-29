import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, SimulatedDevice } from '../types/addresses.js';
import { SimTransport } from '../hardware/simTransport.js';
import type {
  CsvDocument,
  CsvKind,
  CsvResult,
  CsvSaveResult,
  ScanResponse,
  ScanSetupResponse
} from '../shared/types.js';
import { scanAddresses } from '../tests/scanner.js';
import { readCsv, writeCsv } from './csv.js';

const processStartedAt = process.hrtime.bigint();
const startupRunId = new Date().toISOString();
const pendingStartupLog: string[] = [];
let startupLogPath: string | undefined;
let startupLogWriteQueue = Promise.resolve();

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
    const transport = new SimTransport(config.simulation.devices);
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
