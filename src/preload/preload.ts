import { contextBridge, ipcRenderer } from 'electron';
import type {
  CsvKind,
  CsvResult,
  AuditAction,
  AuditActionDetails,
  TestReportRequest,
  UsbR485Api
} from '../shared/types.js';

const api: UsbR485Api = {
  loadCsv: (kind: CsvKind): Promise<CsvResult> => ipcRenderer.invoke('csv:load', kind),
  saveCsv: (document) => ipcRenderer.invoke('csv:save', document),
  loadScanSetup: () => ipcRenderer.invoke('hardware:setup'),
  saveLastOperator: (operator) => ipcRenderer.invoke('hardware:save-operator', operator),
  scanAddresses: (serialNumber, operator) =>
    ipcRenderer.invoke('hardware:scan', { serialNumber, operator }),
  runMotorTest: (address, autoJog) =>
    ipcRenderer.invoke('hardware:run-motor-test', { address, autoJog }),
  cancelMotorTest: () => ipcRenderer.invoke('hardware:cancel-motor-test'),
  setLimitJogging: (held) => ipcRenderer.invoke('hardware:set-limit-jogging', held),
  detectUsbDevices: () => ipcRenderer.invoke('hardware:detect-usb-devices'),
  detectD2xxDevices: () => ipcRenderer.invoke('hardware:detect-d2xx-devices'),
  logActivity: (action: AuditAction, details?: AuditActionDetails) =>
    ipcRenderer.invoke('audit:activity', { action, details }),
  saveTestReport: (request: TestReportRequest) =>
    ipcRenderer.invoke('report:save-test-report', request),
  logStartupStage: (stage) => ipcRenderer.send('startup:log', stage)
};

contextBridge.exposeInMainWorld('UsbR485', api);
