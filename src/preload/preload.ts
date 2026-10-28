import { contextBridge, ipcRenderer } from 'electron';
import type { CsvKind, CsvResult, UsbR485Api } from '../shared/types.js';

const api: UsbR485Api = {
  loadCsv: (kind: CsvKind): Promise<CsvResult> => ipcRenderer.invoke('csv:load', kind),
  saveCsv: (document) => ipcRenderer.invoke('csv:save', document),
  scanAddresses: () => ipcRenderer.invoke('hardware:scan'),
  logStartupStage: (stage) => ipcRenderer.send('startup:log', stage)
};

contextBridge.exposeInMainWorld('UsbR485', api);
