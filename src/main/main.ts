import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CsvDocument, CsvKind, CsvResult, CsvSaveResult } from '../shared/types.js';
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
