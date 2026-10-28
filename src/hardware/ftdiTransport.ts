import {
  assertByte,
  DeviceTimeoutError,
  type DeviceResponse,
  type Transport
} from './transport.js';

export interface D2xxDevice {
  write(data: Uint8Array): Promise<number>;
  read(maxBytes: number): Promise<Uint8Array>;
}

const FRAME_LENGTH = 8;

export class FtdiTransport implements Transport {
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(private readonly device: D2xxDevice) {}

  sendCommand(
    address: number,
    command: number,
    data1: number,
    data2: number
  ): Promise<DeviceResponse> {
    const operation = this.commandQueue.then(() =>
      this.sendCommandNow(address, command, data1, data2)
    );
    this.commandQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async sendCommandNow(
    address: number,
    command: number,
    data1: number,
    data2: number
  ): Promise<DeviceResponse> {
    assertByte(address, 'Address');
    assertByte(command, 'Command');
    assertByte(data1, 'Data1');
    assertByte(data2, 'Data2');

    const checksum = (address + command + data1 + data2) & 0xff;
    const request = Uint8Array.of(0, 0, address, command, data1, data2, checksum, 0);
    const written = await this.device.write(request);
    if (written !== FRAME_LENGTH) {
      throw new Error(`D2XX wrote ${written} of ${FRAME_LENGTH} command bytes.`);
    }

    const response = await this.readFrame();
    if (response[0] !== 0 || response[1] !== 0 || response[7] !== 0) {
      throw new Error('D2XX returned an invalid response frame.');
    }
    const responseChecksum = (
      (response[2] ?? 0) + (response[3] ?? 0) + (response[4] ?? 0) + (response[5] ?? 0)
    ) & 0xff;
    if (response[6] !== responseChecksum) {
      throw new Error('D2XX response checksum is invalid.');
    }

    return {
      address: response[2] ?? 0,
      command: response[3] ?? 0,
      data1: response[4] ?? 0,
      data2: response[5] ?? 0
    };
  }

  private async readFrame(): Promise<Uint8Array> {
    const frame = new Uint8Array(FRAME_LENGTH);
    let bytesRead = 0;
    while (bytesRead < FRAME_LENGTH) {
      const chunk = await this.device.read(FRAME_LENGTH - bytesRead);
      if (chunk.length === 0) {
        throw new DeviceTimeoutError('D2XX timed out while reading a response frame.');
      }
      if (chunk.length > FRAME_LENGTH - bytesRead) {
        throw new Error('D2XX returned more bytes than requested.');
      }
      frame.set(chunk, bytesRead);
      bytesRead += chunk.length;
    }
    return frame;
  }
}
