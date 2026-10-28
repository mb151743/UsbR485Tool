import { readCsv } from '../main/csv.js';
import type { AddressConfig, AddressRange, ScanResult } from '../types/addresses.js';
import {
  DeviceTimeoutError,
  firmwareNumber,
  type Transport
} from '../hardware/transport.js';
import { parseFirmwareVersion } from './firmware.js';

const FIRMWARE_COMMAND = 137;

function normalizedHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [
    header.toLowerCase().replace(/[^a-z0-9]/g, ''),
    index
  ]));
}

function requiredColumn(headers: Map<string, number>, names: string[], label: string): number {
  for (const name of names) {
    const index = headers.get(name);
    if (index !== undefined) return index;
  }
  throw new Error(`Addresses.csv is missing the required ${label} column.`);
}

function cell(row: string[], index: number, lineNumber: number, label: string): string {
  const value = row[index];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Addresses.csv row ${lineNumber} has an empty ${label}.`);
  }
  return value.trim();
}

async function loadAddressConfig(csvPath: string): Promise<Map<number, AddressConfig>> {
  const csv = await readCsv(csvPath, 'Addresses.csv');
  const headers = normalizedHeaders(csv.headers);
  const addressColumn = requiredColumn(headers, ['address'], 'Address');
  const descriptionColumn = requiredColumn(headers, ['description'], 'Description');
  const testNameColumn = headers.get('testname');
  const firmwareColumn = requiredColumn(headers, ['firmwareversion', 'fwversion'], 'FirmwareVersion');
  const configs = new Map<number, AddressConfig>();

  csv.rows.forEach((row, index) => {
    const lineNumber = index + 2;
    const addressValue = cell(row, addressColumn, lineNumber, 'Address');
    const address = Number(addressValue);
    if (!Number.isInteger(address) || address < 0 || address > 255) {
      throw new Error(`Addresses.csv row ${lineNumber} has an invalid address "${addressValue}".`);
    }
    if (configs.has(address)) {
      throw new Error(`Addresses.csv contains duplicate address ${address}.`);
    }

    const firmwareText = cell(row, firmwareColumn, lineNumber, 'firmware version');
    const description = row[descriptionColumn]?.trim() || `Address ${address}`;
    configs.set(address, {
      address,
      description,
      testName: testNameColumn === undefined ? '' : row[testNameColumn]?.trim() ?? '',
      expectedFirmware: parseFirmwareVersion(firmwareText, `Addresses.csv row ${lineNumber} firmware version`)
    });
  });
  return configs;
}

function validateRange(range: AddressRange): void {
  if (
    !Number.isInteger(range.start) || !Number.isInteger(range.end) ||
    range.start < 0 || range.end > 255 || range.start > range.end
  ) {
    throw new RangeError('The configured address range must be an ascending range from 0 to 255.');
  }
}

export async function scanAddresses(
  transport: Transport,
  csvPath: string,
  range: AddressRange
): Promise<ScanResult[]> {
  validateRange(range);
  const addressConfig = await loadAddressConfig(csvPath);
  const results: ScanResult[] = [];

  for (let address = range.start; address <= range.end; address += 1) {
    const config = addressConfig.get(address);
    const description = config?.description ?? `Address ${address}`;
    const expectedFirmware = config?.expectedFirmware ?? 0;
    let actualFirmware = 0;
    let connected = false;

    try {
      const response = await transport.sendCommand(address, FIRMWARE_COMMAND, 0, 0);
      if (response.address === address && response.command === FIRMWARE_COMMAND) {
        connected = true;
        actualFirmware = firmwareNumber(response.data1, response.data2);
      }
    } catch (error) {
      if (!(error instanceof DeviceTimeoutError)) throw error;
    }

    results.push({
      address,
      description,
      expectedFirmware,
      actualFirmware,
      connected,
      firmwareMatch: connected && actualFirmware === expectedFirmware
    });
  }

  return results;
}
