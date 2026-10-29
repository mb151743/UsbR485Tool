export interface AddressConfig {
  address: number;
  description: string;
  testName: string;
  expectedFirmware: number;
}

export interface ScanResult {
  address: number;
  description: string;
  expectedFirmware: number;
  actualFirmware: number;
  connected: boolean;
  firmwareMatch: boolean;
}

export interface AddressRange {
  start: number;
  end: number;
}

export interface SimulatedDevice {
  address: number;
  firmwareMajor: number;
  firmwareMinor: number;
}

export interface AppConfig {
  transport: 'simulation' | 'ftdi';
  addressRange: AddressRange;
  simulation: {
    devices: SimulatedDevice[];
  };
  lastOperator: string;
}
