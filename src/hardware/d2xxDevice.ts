import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type * as Koffi from 'koffi' with { 'resolution-mode': 'import' };
import type { D2xxDevice } from './ftdiTransport.js';

const koffi: typeof Koffi = createRequire(__filename)('koffi');

const FT_OK = 0;
const FT_OPEN_BY_DESCRIPTION = 2;
const READ_TIMEOUT_MS = 500;
const READ_POLL_INTERVAL_MS = 5;
const SUPPORTED_DESCRIPTIONS = ['RA802', 'SEMSCA', 'MSC20'] as const;
let cachedD2xxApi: D2xxApi | undefined;

interface D2xxApi {
  library: ReturnType<typeof koffi.load>;
  libraryPath: string;
  createDeviceInfoList: (count: number[]) => number;
  getDeviceInfoDetail: (
    index: number,
    flags: number[],
    type: number[],
    id: number[],
    location: number[],
    serialNumber: Buffer,
    description: Buffer,
    handle: Array<bigint | null>
  ) => number;
  openEx: (description: string, flags: number, handle: Array<bigint | null>) => number;
  setTimeouts: (handle: bigint, readTimeout: number, writeTimeout: number) => number;
  setLatencyTimer: (handle: bigint, latency: number) => number;
  getStatus: (
    handle: bigint,
    receiveBytes: number[],
    transmitBytes: number[],
    events: number[]
  ) => number;
  read: (handle: bigint, buffer: Buffer, bytesToRead: number, bytesRead: number[]) => number;
  write: (handle: bigint, buffer: Uint8Array, bytesToWrite: number, bytesWritten: number[]) => number;
  close: (handle: bigint) => number;
}

function d2xxDllCandidates(applicationDirectory: string): string[] {
  const configuredPath = process.env.FTD2XX_DLL_PATH;
  if (configuredPath) return [path.resolve(configuredPath)];

  const candidates: string[] = [];
  if (process.env.SystemRoot) {
    for (const fileName of ['FTD2XX64.dll', 'ftd2xx.dll']) {
      candidates.push(path.join(process.env.SystemRoot, 'System32', fileName));
    }
  }
  for (const fileName of ['FTD2XX64.dll', 'ftd2xx.dll']) {
    candidates.push(path.join(applicationDirectory, fileName));
  }
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

function loadD2xxApi(applicationDirectory: string): D2xxApi {
  if (process.platform !== 'win32') {
    throw new Error('FTDI D2XX hardware is supported on Windows only.');
  }
  if (process.arch !== 'x64') {
    throw new Error('The FTDI D2XX adapter requires the 64-bit Windows application.');
  }
  if (cachedD2xxApi) return cachedD2xxApi;

  const candidates = d2xxDllCandidates(applicationDirectory);
  const existingCandidates = candidates.filter(existsSync);
  if (existingCandidates.length === 0) {
    throw new Error(
      'A compatible 64-bit FTDI D2XX driver was not found. Install the x64 FTDI D2XX driver ' +
      'or set FTD2XX_DLL_PATH to its DLL. The legacy VB6 ftd2xx.dll is 32-bit and cannot be used.'
    );
  }

  let library: ReturnType<typeof koffi.load> | undefined;
  let libraryPath: string | undefined;
  const errors: string[] = [];
  for (const candidate of existingCandidates) {
    try {
      library = koffi.load(candidate);
      libraryPath = candidate;
      break;
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!library || !libraryPath) {
    throw new Error(
      `Could not load a compatible FTDI D2XX DLL. ${errors.join('; ')}`
    );
  }

  const api: D2xxApi = {
    library,
    libraryPath,
    createDeviceInfoList: library.func(
      'uint32_t __stdcall FT_CreateDeviceInfoList(_Out_ uint32_t *count)'
    ),
    getDeviceInfoDetail: library.func(
      'uint32_t __stdcall FT_GetDeviceInfoDetail(uint32_t index, ' +
      '_Out_ uint32_t *flags, _Out_ uint32_t *type, _Out_ uint32_t *id, ' +
      '_Out_ uint32_t *location, _Out_ uint8_t *serialNumber, ' +
      '_Out_ uint8_t *description, _Out_ void **handle)'
    ),
    openEx: library.func(
      'uint32_t __stdcall FT_OpenEx(const char *description, uint32_t flags, _Out_ void **handle)'
    ),
    setTimeouts: library.func(
      'uint32_t __stdcall FT_SetTimeouts(void *handle, uint32_t readTimeout, uint32_t writeTimeout)'
    ),
    setLatencyTimer: library.func(
      'uint32_t __stdcall FT_SetLatencyTimer(void *handle, uint8_t latency)'
    ),
    getStatus: library.func(
      'uint32_t __stdcall FT_GetStatus(void *handle, _Out_ uint32_t *receiveBytes, ' +
      '_Out_ uint32_t *transmitBytes, _Out_ uint32_t *events)'
    ),
    read: library.func(
      'uint32_t __stdcall FT_Read(void *handle, _Out_ uint8_t *buffer, ' +
      'uint32_t bytesToRead, _Out_ uint32_t *bytesRead)'
    ),
    write: library.func(
      'uint32_t __stdcall FT_Write(void *handle, const uint8_t *buffer, ' +
      'uint32_t bytesToWrite, _Out_ uint32_t *bytesWritten)'
    ),
    close: library.func('uint32_t __stdcall FT_Close(void *handle)')
  };
  cachedD2xxApi = api;
  return api;
}

function checkStatus(status: number, operation: string): void {
  if (status !== FT_OK) {
    throw new Error(`FTDI ${operation} failed with D2XX status ${status}.`);
  }
}

function decodeFixedString(buffer: Buffer): string {
  const end = buffer.indexOf(0);
  return buffer.toString('latin1', 0, end === -1 ? buffer.length : end).trim();
}

interface DeviceDescriptor {
  description: string;
  opened: boolean;
}

function enumerateDevices(api: D2xxApi): DeviceDescriptor[] {
  const count = [0];
  checkStatus(api.createDeviceInfoList(count), 'device enumeration');
  const devices: DeviceDescriptor[] = [];

  for (let index = 0; index < (count[0] ?? 0); index += 1) {
    const flags = [0];
    const type = [0];
    const id = [0];
    const location = [0];
    const serialNumber = Buffer.alloc(16);
    const description = Buffer.alloc(64);
    const deviceHandle: Array<bigint | null> = [null];
    checkStatus(
      api.getDeviceInfoDetail(
        index,
        flags,
        type,
        id,
        location,
        serialNumber,
        description,
        deviceHandle
      ),
      `reading device ${index} information`
    );
    devices.push({
      description: decodeFixedString(description),
      opened: ((flags[0] ?? 0) & 1) !== 0
    });
  }

  return devices;
}

export function detectD2xxDevices(applicationDirectory: string): {
  libraryPath: string;
  devices: string[];
} {
  const api = loadD2xxApi(applicationDirectory);
  return {
    libraryPath: api.libraryPath,
    devices: enumerateDevices(api).map((device) =>
      `${device.description}${device.opened ? ' (already open)' : ''}`
    )
  };
}

class OpenD2xxDevice implements D2xxDevice {
  private closed = false;

  constructor(private readonly api: D2xxApi, private readonly handle: bigint) {}

  async write(data: Uint8Array): Promise<number> {
    this.assertOpen();
    const buffer = Buffer.from(data);
    const bytesWritten = [0];
    checkStatus(
      this.api.write(this.handle, buffer, buffer.length, bytesWritten),
      'write'
    );
    return bytesWritten[0] ?? 0;
  }

  async read(maxBytes: number): Promise<Uint8Array> {
    this.assertOpen();
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('D2XX read size must be a positive integer.');
    }

    const deadline = Date.now() + READ_TIMEOUT_MS;
    let availableBytes = 0;
    while (availableBytes === 0 && Date.now() < deadline) {
      const receiveBytes = [0];
      const transmitBytes = [0];
      const events = [0];
      checkStatus(
        this.api.getStatus(this.handle, receiveBytes, transmitBytes, events),
        'read status'
      );
      availableBytes = receiveBytes[0] ?? 0;
      if (availableBytes === 0) await delay(READ_POLL_INTERVAL_MS);
    }
    if (availableBytes === 0) return new Uint8Array();

    const buffer = Buffer.alloc(Math.min(maxBytes, availableBytes));
    const bytesRead = [0];
    checkStatus(
      this.api.read(this.handle, buffer, buffer.length, bytesRead),
      'read'
    );
    return new Uint8Array(buffer.subarray(0, bytesRead[0] ?? 0));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    checkStatus(this.api.close(this.handle), 'close');
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The FTDI D2XX device is already closed.');
  }
}

export async function openD2xxDevice(
  applicationDirectory: string
): Promise<D2xxDevice & { close(): Promise<void> }> {
  const api = loadD2xxApi(applicationDirectory);
  const devices = enumerateDevices(api);
  const openFailures: string[] = [];
  for (const supportedName of SUPPORTED_DESCRIPTIONS) {
    const device = devices.find((candidate) =>
      !candidate.opened && candidate.description.toUpperCase().includes(supportedName)
    );
    if (!device) continue;

    const handle: Array<bigint | null> = [null];
    const openStatus = api.openEx(device.description, FT_OPEN_BY_DESCRIPTION, handle);
    if (openStatus !== FT_OK) {
      openFailures.push(`${device.description} (D2XX status ${openStatus})`);
      continue;
    }
    const openedHandle = handle[0];
    if (openedHandle === null || openedHandle === undefined) {
      throw new Error(`FTDI opened ${device.description} without returning a device handle.`);
    }

    const openedDevice = new OpenD2xxDevice(api, openedHandle);
    try {
      checkStatus(api.setTimeouts(openedHandle, READ_TIMEOUT_MS, READ_TIMEOUT_MS), 'set timeouts');
      checkStatus(api.setLatencyTimer(openedHandle, 2), 'set latency timer');
    } catch (error) {
      await openedDevice.close();
      throw error;
    }
    return openedDevice;
  }

  const supportedDevices = devices
    .map((device) => device.description)
    .filter((description) =>
      SUPPORTED_DESCRIPTIONS.some((name) => description.toUpperCase().includes(name))
    );
  if (supportedDevices.length > 0) {
    throw new Error(
      `Found supported FTDI device(s) but could not open any: ` +
      `${openFailures.join(', ') || supportedDevices.join(', ')}.`
    );
  }
  throw new Error(
    `No supported FTDI D2XX device found. Expected ${SUPPORTED_DESCRIPTIONS.join(', ')}.`
  );
}
