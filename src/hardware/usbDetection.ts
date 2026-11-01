import { execFile } from 'node:child_process';
import type { SupportedUsbDevice, UsbDetectionResult } from '../shared/types.js';

const SUPPORTED_USB_DEVICES: readonly SupportedUsbDevice[] = ['RA802', 'SEMSCA', 'MSC20'];

export function classifyUsbDeviceNames(names: readonly string[]): SupportedUsbDevice[] {
  const normalizedNames = names.map((name) => name.toUpperCase());
  return SUPPORTED_USB_DEVICES.filter((device) =>
    normalizedNames.some((name) => name.includes(device))
  );
}

function readWindowsUsbDeviceNames(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-PnpDevice -PresentOnly | ForEach-Object FriendlyName'
      ],
      { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const reason = stderr.trim() || error.message;
          reject(new Error(`Windows USB device detection failed: ${reason}`));
          return;
        }
        resolve(stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean));
      }
    );
  });
}

export async function detectSupportedUsbDevices(): Promise<UsbDetectionResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      devices: [],
      error: 'USB device detection is currently supported on Windows only.'
    };
  }
  try {
    const names = await readWindowsUsbDeviceNames();
    return {
      ok: true,
      devices: classifyUsbDeviceNames(names),
      source: 'windows-pnp'
    };
  } catch (error) {
    return {
      ok: false,
      devices: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
