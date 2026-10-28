import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CsvKind, CsvResult } from '../shared/types.js';
import { readCsv } from './csv.js';

function externalCsvDirectory(): string {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
  }
  return app.getAppPath();
}

async function loadCsv(kind: CsvKind): Promise<CsvResult> {
  const csvPath = path.join(externalCsvDirectory(), kind);
  try {
    if (!existsSync(csvPath)) throw new Error(`Could not find ${kind} beside the executable.`);
    return { ok: true, document: await readCsv(csvPath, kind) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function createWindow(): void {
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
  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('csv:load', (_event, kind: CsvKind) => loadCsv(kind));

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
