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
  motorTest?: MotorTestPlan;
}

export interface MotorTestPlan {
  reference: boolean;
  targets: Array<{
    label: string;
    position: number;
  }>;
  switchChecks: Array<{
    label: string;
    move: number;
    statusMask: number;
  }>;
}

export type MotorAttemptResult =
  | { passed: true }
  | { passed: false; error: string };

export interface MotorTestRecord {
  address: number;
  description: string;
  status: 'passed' | 'failed' | 'ignored' | 'not-tested';
  attempts: MotorAttemptResult[];
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
