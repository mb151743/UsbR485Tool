import type { SimulatedDevice } from '../types/addresses.js';
import {
  assertByte,
  DeviceTimeoutError,
  type DeviceResponse,
  type Transport
} from './transport.js';

export class SimTransport implements Transport {
  private readonly devices: ReadonlyMap<number, SimulatedDevice>;

  constructor(devices: readonly SimulatedDevice[]) {
    const deviceMap = new Map<number, SimulatedDevice>();
    for (const device of devices) {
      assertByte(device.address, 'Simulated device address');
      assertByte(device.firmwareMajor, 'Simulated firmware major version');
      if (!Number.isInteger(device.firmwareMinor) || device.firmwareMinor < 0 || device.firmwareMinor > 99) {
        throw new RangeError('Simulated firmware minor version must be an integer from 0 to 99.');
      }
      if (deviceMap.has(device.address)) {
        throw new Error(`Simulation config contains duplicate address ${device.address}.`);
      }
      deviceMap.set(device.address, device);
    }
    this.devices = deviceMap;
  }

  async sendCommand(
    address: number,
    command: number,
    _data1: number,
    _data2: number
  ): Promise<DeviceResponse> {
    assertByte(address, 'Address');
    assertByte(command, 'Command');
    const device = this.devices.get(address);
    if (!device) throw new DeviceTimeoutError(`No simulated device responded at address ${address}.`);

    return {
      address,
      command,
      data1: command === 137 ? device.firmwareMajor : 0,
      data2: command === 137 ? device.firmwareMinor : 0
    };
  }
}
