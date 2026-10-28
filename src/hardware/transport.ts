export interface DeviceResponse {
  address: number;
  command: number;
  data1: number;
  data2: number;
}

export interface Transport {
  sendCommand(
    address: number,
    command: number,
    data1: number,
    data2: number
  ): Promise<DeviceResponse>;
}

export class DeviceTimeoutError extends Error {
  constructor(message = 'The device did not respond before the timeout.') {
    super(message);
    this.name = 'DeviceTimeoutError';
  }
}

export function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be an integer from 0 to 255.`);
  }
}

export function firmwareNumber(major: number, minor: number): number {
  assertByte(major, 'Firmware major version');
  if (!Number.isInteger(minor) || minor < 0 || minor > 99) {
    throw new RangeError('Firmware minor version must be an integer from 0 to 99.');
  }
  return Number(`${major}.${String(minor).padStart(2, '0')}`);
}

export function formatFirmware(version: number): string {
  const [major = '0', minor = '0'] = version.toFixed(2).split('.');
  return `${major}.${minor.padStart(2, '0')}`;
}
