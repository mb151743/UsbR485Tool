import { firmwareNumber } from '../hardware/transport.js';

export function parseFirmwareVersion(value: string, context: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`${context} must be a major version optionally followed by up to two minor digits.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2] ?? '0');
  return firmwareNumber(major, minor);
}
