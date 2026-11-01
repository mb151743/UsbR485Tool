import { readCsv } from '../main/csv.js';
import type { MotorAttemptResult, MotorTestPlan } from '../types/addresses.js';
import type { Transport } from '../hardware/transport.js';

const REFERENCE_COMMAND = 132;
const STATUS_COMMAND = 128;
const ABORT_COMMAND = 131;
const POLL_INTERVAL_MS = 100;
const OPERATION_TIMEOUT_MS = 120_000;

function normalizedHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [
    header.toLowerCase().replace(/[^a-z0-9]/g, ''),
    index
  ]));
}

function requiredColumn(headers: Map<string, number>, ...names: string[]): number {
  for (const name of names) {
    const index = headers.get(name);
    if (index !== undefined) return index;
  }
  throw new Error(`Addresses.csv is missing the ${names[0]} column.`);
}

function ignored(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === undefined || normalized === '' ||
    normalized === 'ignore' || normalized === 'ingore' || normalized === 'no ref';
}

function parsePosition(value: string, context: string): number {
  const position = Number(value.trim());
  if (!Number.isSafeInteger(position) || position < -0x800000 || position > 0x7fffff) {
    throw new Error(`${context} must be a whole number from -8388608 to 8388607.`);
  }
  return position;
}

function parseSwitchMove(value: string, context: string): number {
  const move = Number(value.trim());
  if (!Number.isInteger(move) || move < -32_768 || move > 32_767) {
    throw new Error(`${context} must be a whole number from -32768 to 32767.`);
  }
  return move;
}

export async function loadMotorTestPlans(csvPath: string): Promise<Map<number, MotorTestPlan>> {
  const csv = await readCsv(csvPath, 'Addresses.csv');
  const headers = normalizedHeaders(csv.headers);
  const addressColumn = requiredColumn(headers, 'address');
  const descriptionColumn = requiredColumn(headers, 'description');
  const testNameColumn = headers.get('testname');
  const referenceColumn = requiredColumn(headers, 'reference', 'ref');
  const lowerColumn = requiredColumn(headers, 'lowerlimit');
  const upperColumn = requiredColumn(headers, 'upperlimit');
  const endColumn = requiredColumn(headers, 'endposition');
  const switch1Column = headers.get('switch1');
  const switch2Column = headers.get('switch2');
  const plans = new Map<number, MotorTestPlan>();

  csv.rows.forEach((row, index) => {
    const lineNumber = index + 2;
    if (row[testNameColumn ?? -1]?.trim().toLowerCase() !== 'motor') return;

    const addressValue = row[addressColumn]?.trim() ?? '';
    const address = Number(addressValue);
    if (!Number.isInteger(address) || address < 0 || address > 255) {
      throw new Error(`Addresses.csv row ${lineNumber} has an invalid motor address "${addressValue}".`);
    }
    if (plans.has(address)) {
      throw new Error(`Addresses.csv contains duplicate motor address ${address}.`);
    }

    const referenceValue = row[referenceColumn]?.trim().toLowerCase() ?? '';
    if (referenceValue !== 'ref' && !ignored(referenceValue)) {
      throw new Error(`Addresses.csv row ${lineNumber} has an invalid reference setting.`);
    }

    const targets = [
      { label: 'Lower limit', value: row[lowerColumn] },
      { label: 'Upper limit', value: row[upperColumn] },
      { label: 'End position', value: row[endColumn] }
    ].flatMap(({ label, value }) => {
      if (ignored(value)) return [];
      return [{
        label,
        position: parsePosition(value ?? '', `Addresses.csv row ${lineNumber} ${label}`)
      }];
    });
    const switchChecks = [
      { label: 'Limit switch 1', column: switch1Column, statusMask: 8 },
      { label: 'Limit switch 2', column: switch2Column, statusMask: 16 }
    ].flatMap(({ label, column, statusMask }) =>
      column !== undefined && !ignored(row[column])
        ? [{
            label,
            move: parseSwitchMove(row[column] ?? '', `Addresses.csv row ${lineNumber} ${label}`),
            statusMask
          }]
        : []
    );

    if (!referenceValue && targets.length === 0 && switchChecks.length === 0) {
      throw new Error(`Addresses.csv row ${lineNumber} has no motor test steps.`);
    }
    plans.set(address, {
      reference: referenceValue === 'ref',
      targets,
      switchChecks
    });
  });
  return plans;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function pollForStatus(
  transport: Transport,
  address: number,
  mask: number,
  signal: AbortSignal
): Promise<void> {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Motor test was stopped by the operator.');
    const response = await transport.sendCommand(address, STATUS_COMMAND, 0, 0);
    if (response.address !== address || response.command !== STATUS_COMMAND) {
      throw new Error(`Address ${address} returned an invalid status response.`);
    }
    if ((response.data2 & mask) === mask) return;
    await delay(POLL_INTERVAL_MS, signal);
  }
  throw new Error(`Motor at address ${address} did not complete before the 120 second timeout.`);
}

async function abortMove(transport: Transport, address: number): Promise<void> {
  const response = await transport.sendCommand(address, ABORT_COMMAND, 0, 0);
  if (response.address !== address || response.command !== ABORT_COMMAND) {
    throw new Error(`Address ${address} returned an invalid abort response.`);
  }
}

async function runOperation(
  transport: Transport,
  address: number,
  command: number,
  data1: number,
  data2: number,
  statusMask: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw new Error('Motor test was stopped by the operator.');
  const commandResponse = await transport.sendCommand(address, command, data1, data2);
  if (commandResponse.address !== address || commandResponse.command !== command) {
    throw new Error(`Address ${address} returned an invalid response to command ${command}.`);
  }
  await pollForStatus(transport, address, statusMask, signal);
}

async function runLimitSwitchCheck(
  transport: Transport,
  address: number,
  move: number,
  statusMask: number,
  signal: AbortSignal,
  isDownHeld: () => boolean,
  autoJog: boolean
): Promise<void> {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  const unsignedMove = ((move % 65_536) + 65_536) % 65_536;
  const data1 = Math.floor(unsignedMove / 256);
  const data2 = unsignedMove & 0xff;
  let wasJogging = false;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Motor test was stopped by the operator.');

    const downHeld = autoJog || isDownHeld();
    if (downHeld) {
      const response = await transport.sendCommand(address, 130, data1, data2);
      if (response.address !== address || response.command !== 130) {
        throw new Error(`Address ${address} returned an invalid relative-move response.`);
      }
      wasJogging = true;
    } else if (wasJogging) {
      await abortMove(transport, address);
      wasJogging = false;
    }

    const response = await transport.sendCommand(address, STATUS_COMMAND, 0, 0);
    if (response.address !== address || response.command !== STATUS_COMMAND) {
      throw new Error(`Address ${address} returned an invalid status response.`);
    }
    if ((response.data2 & statusMask) !== 0) {
      await abortMove(transport, address);
      return;
    }
    await delay(POLL_INTERVAL_MS, signal);
  }
  throw new Error(`Limit switch did not register before the 120 second timeout.`);
}

export async function runMotorTest(
  transport: Transport,
  address: number,
  description: string,
  plan: MotorTestPlan,
  signal: AbortSignal,
  isDownHeld: () => boolean = () => false,
  autoJog = false
): Promise<MotorAttemptResult> {
  try {
    for (const switchCheck of plan.switchChecks) {
      await runLimitSwitchCheck(
        transport,
        address,
        switchCheck.move,
        switchCheck.statusMask,
        signal,
        isDownHeld,
        autoJog
      );
    }
    if (plan.reference) {
      await runOperation(transport, address, REFERENCE_COMMAND, 0, 0, 3, signal);
    }
    for (const target of plan.targets) {
      const position = target.position;
      const command = (Math.floor(position / 65_536) & 0xff);
      const data1 = (Math.floor(position / 256) & 0xff);
      const data2 = position & 0xff;
      await runOperation(transport, address, command, data1, data2, 2, signal);
    }
    return { passed: true };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    try {
      await abortMove(transport, address);
      if (signal.aborted) message = 'Motor test was stopped by the operator.';
    } catch (abortError) {
      message = `${message} Abort command failed: ${
        abortError instanceof Error ? abortError.message : String(abortError)
      }`;
    }
    return { passed: false, error: `${description}: ${message}` };
  }
}
