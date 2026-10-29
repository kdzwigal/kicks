/**
 * Typings and interfaces for Triki BLE sensor telemetry and app state
 */

export interface RawSensorSample {
  timestamp: number; // performance.now() or sensor packet timestamp
  packetIndex: number;
  accel: {
    x: number; // g
    y: number;
    z: number;
  };
  gyro: {
    x: number; // rad/s
    y: number;
    z: number;
  };
  button: boolean;
  buttonRawByte?: number; // raw byte[1] value (e.g. 0x00 or 0x01)
  batteryLevel?: number; // 0-100%
  rawBytes?: Uint8Array;
}

export type FusionFilterMode = 'complementary' | 'madgwick';

export type ButtonMode = 'exact-01' | 'bit0' | 'inverted' | 'nonzero' | 'manual' | 'tap';

export interface CalibratedSample extends RawSensorSample {
  accelMagnitude: number;
  gyroMagnitude: number;
  buttonPressCount: number;
  quaternion: {
    w: number;
    x: number;
    y: number;
    z: number;
  };
  euler: {
    roll: number; // degrees
    pitch: number;
    yaw: number;
  };
  gesture: 'idle' | 'tap' | 'double_tap' | 'shake' | 'freefall' | 'tilt_left' | 'tilt_right';
}

export interface SensorCalibration {
  gyroBiasX: number;
  gyroBiasY: number;
  gyroBiasZ: number;
  accelOffsetX: number;
  accelOffsetY: number;
  accelOffsetZ: number;
  isCalibrated: boolean;
  samplesCollected: number;
}

export type LayoutMode = 'split' | 'dual-foot' | 'aviation' | 'signal' | 'rn-architecture';

export type ThemeMode = 'clean-light' | 'eink';

export type LedControlMethod = 'auto' | 'char-6e400004' | 'nus-rx-01' | 'nus-rx-vendor' | 'both';

export type FootSide = 'left' | 'right';

export type FootPhase = 'stance' | 'swing';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface FootprintMarker {
  id: number;
  side: FootSide;
  x: number;
  z: number;
  yawDeg: number;
  timestamp: number;
  stepLengthMeters: number;
}

export interface FootKinematicState {
  side: FootSide;
  phase: FootPhase;
  isStationaryZupt: boolean;
  position: Vector3D; // meters in world frame (x: lateral, y: vertical height, z: forward/backward)
  velocity: Vector3D; // m/s in world frame
  worldAccel: Vector3D; // m/s^2 linear acceleration with gravity removed
  speedMps: number;
  stepCount: number;
  lastStepLengthMeters: number;
  avgStepLengthMeters: number;
  maxStepHeightMeters: number; // peak vertical lift during current/last step
  currentLiftHeightMeters: number;
  totalDistanceMeters: number;
  cadenceSpm: number; // steps per minute
  latestSample: CalibratedSample | null;
  trail: Vector3D[]; // 3D trajectory points
}

export interface ZuptConfig {
  gyroThresholdRad: number; // default: 0.18 rad/s
  accelThresholdG: number; // default: 0.09 g deviation from 1.0g
  stanceFramesRequired: number; // default: 5 frames (~50ms)
  velocityDamping: number; // default: 0.96 velocity decay during swing
  minStepDistanceMeters: number; // default: 0.08 m
}

export interface FilterConfig {
  mode: FusionFilterMode;
  compAlpha: number; // 0.50 - 0.999 (default: 0.95)
  madgwickBeta: number; // 0.01 - 0.50 (default: 0.08)
  rawAccelLpfFactor: number; // 0.0 - 0.80 (default: 0.15)
  rawGyroDeadband: number; // 0.0 - 0.10 rad/s (default: 0.025)
  swapPitchRoll: boolean; // default: true (permanent pitch ⇄ roll swap)
  invertPitch: boolean; // default: true (inverted as requested: "owroc pitch")
  invertRoll: boolean; // default: false (canceled as requested: "anuluj odwrocenie roll")
  invertYaw: boolean; // default: true (inverted)
  yawScaleMultiplier: number; // default: 1.0 (fine-tuning multiplier for full 360° rotation)
  accelScaleMultiplier: number; // default: 1.0 (fine-tuning multiplier for 1.00g resting Earth gravity)
}

export interface BLEConnectionState {
  status: 'disconnected' | 'searching' | 'connecting' | 'connected' | 'error';
  deviceName?: string;
  deviceId?: string;
  serviceUuid?: string;
  packetsReceived: number;
  packetRateHz: number;
  latencyMs: number;
  errorMessage?: string;
  isWebBluetoothSupported: boolean;
  lastCommandStatus?: string;
  rawBytesHex?: string;
  buttonMode: ButtonMode;
  buttonPressCount: number;
  lastButtonRawByte?: number;
  ledEnabled?: boolean;
  ledMethod?: LedControlMethod;
  debugLogs: string[];
}


