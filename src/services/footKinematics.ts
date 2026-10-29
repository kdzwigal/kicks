/**
 * Dual-Foot 3D Spatial Kinematics Engine with ZUPT (Zero-Velocity Update)
 * Processes two real-time IMU streams (Left & Right Foot Triki pucks) at ~98 Hz.
 * Eliminates velocity drift during every stance phase when the foot touches the ground.
 */

import {
  CalibratedSample,
  FootKinematicState,
  FootprintMarker,
  FootSide,
  Vector3D,
  ZuptConfig,
} from '../types/triki';

const GRAVITY_MPS2 = 9.80665;
const MAX_TRAIL_POINTS = 320;
const MAX_FOOTPRINTS = 60;

interface InternalFootTracker {
  state: FootKinematicState;
  lastTimestamp: number;
  stanceCounter: number;
  swingCounter: number;
  stepStartPos: Vector3D;
  peakHeightInSwing: number;
  worldGravityBaseline: Vector3D;
  gravityInitialized: boolean;
  stepTimestamps: number[];
}

function createInitialFootState(side: FootSide): FootKinematicState {
  const startX = side === 'left' ? -0.16 : 0.16;
  return {
    side,
    phase: 'stance',
    isStationaryZupt: true,
    position: { x: startX, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    worldAccel: { x: 0, y: 0, z: 0 },
    speedMps: 0,
    stepCount: 0,
    lastStepLengthMeters: 0,
    avgStepLengthMeters: 0,
    maxStepHeightMeters: 0,
    currentLiftHeightMeters: 0,
    totalDistanceMeters: 0,
    cadenceSpm: 0,
    latestSample: null,
    trail: [{ x: startX, y: 0, z: 0 }],
  };
}

function createTracker(side: FootSide): InternalFootTracker {
  const initial = createInitialFootState(side);
  return {
    state: initial,
    lastTimestamp: 0,
    stanceCounter: 10,
    swingCounter: 0,
    stepStartPos: { ...initial.position },
    peakHeightInSwing: 0,
    worldGravityBaseline: { x: 0, y: 1.0, z: 0 },
    gravityInitialized: false,
    stepTimestamps: [],
  };
}

/**
 * Rotate sensor-frame acceleration (ax, ay, az in g) into Three.js world frame
 * using Euler angles (Pitch, Yaw, Roll in degrees, YXZ order).
 * In Three.js world frame:
 * +X = Right, +Y = Up (vertical height), -Z = Forward (direction of +Y LED on puck)
 */
function rotateAccelToWorld(
  ax: number,
  ay: number,
  az: number,
  pitchDeg: number,
  rollDeg: number,
  yawDeg: number
): Vector3D {
  const rx = (-pitchDeg * Math.PI) / 180.0;
  const ry = (-yawDeg * Math.PI) / 180.0;
  const rz = (-rollDeg * Math.PI) / 180.0;

  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Map sensor local axes to Three.js local object axes:
  // Sensor X -> Three.js +X (right)
  // Sensor Z (1g normal) -> Three.js +Y (up)
  // Sensor Y (+Y green LED forward) -> Three.js -Z (forward)
  const lx = ax;
  const ly = az;
  const lz = -ay;

  // Apply Z rotation (Roll)
  const x1 = lx * cz - ly * sz;
  const y1 = lx * sz + ly * cz;
  const z1 = lz;

  // Apply X rotation (Pitch)
  const x2 = x1;
  const y2 = y1 * cx - z1 * sx;
  const z2 = y1 * sx + z1 * cx;

  // Apply Y rotation (Yaw)
  const wx = x2 * cy + z2 * sy;
  const wy = y2;
  const wz = -x2 * sy + z2 * cy;

  return { x: wx, y: wy, z: wz };
}

export class DualFootKinematicsEngine {
  private leftTracker: InternalFootTracker = createTracker('left');
  private rightTracker: InternalFootTracker = createTracker('right');
  private footprints: FootprintMarker[] = [];
  private footprintIdSeq: number = 1;
  private swappedLeftRight: boolean = false;

  private config: ZuptConfig = {
    gyroThresholdRad: 0.18,
    accelThresholdG: 0.09,
    stanceFramesRequired: 5,
    velocityDamping: 0.96,
    minStepDistanceMeters: 0.07,
  };

  private listeners: Set<() => void> = new Set();

  public getConfig(): ZuptConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<ZuptConfig>): void {
    this.config = { ...this.config, ...partial };
    this.notify();
  }

  public isSwapped(): boolean {
    return this.swappedLeftRight;
  }

  public setSwapped(swapped: boolean): void {
    this.swappedLeftRight = swapped;
    this.notify();
  }

  public toggleSwapSides(): boolean {
    this.swappedLeftRight = !this.swappedLeftRight;
    this.notify();
    return this.swappedLeftRight;
  }

  public getFootState(side: FootSide): FootKinematicState {
    return side === 'left' ? this.leftTracker.state : this.rightTracker.state;
  }

  public getFootprints(): FootprintMarker[] {
    return this.footprints;
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  /**
   * Reset both feet to origin (0,0,0) and clear trails & footprints
   */
  public resetAll(): void {
    this.leftTracker = createTracker('left');
    this.rightTracker = createTracker('right');
    this.footprints = [
      {
        id: this.footprintIdSeq++,
        side: 'left',
        x: -0.16,
        z: 0,
        yawDeg: 0,
        timestamp: performance.now(),
        stepLengthMeters: 0,
      },
      {
        id: this.footprintIdSeq++,
        side: 'right',
        x: 0.16,
        z: 0,
        yawDeg: 0,
        timestamp: performance.now(),
        stepLengthMeters: 0,
      },
    ];
    this.notify();
  }

  /**
   * Clear only 3D trail ribbons and footprints while keeping current position & step count
   */
  public clearTrails(): void {
    this.leftTracker.state.trail = [{ ...this.leftTracker.state.position }];
    this.rightTracker.state.trail = [{ ...this.rightTracker.state.position }];
    this.footprints = [];
    this.notify();
  }

  /**
   * Feed a calibrated sample from hardware channel ('primary' or 'secondary')
   */
  public processChannelSample(channel: 'primary' | 'secondary', sample: CalibratedSample): void {
    const targetSide: FootSide =
      channel === 'primary'
        ? this.swappedLeftRight
          ? 'right'
          : 'left'
        : this.swappedLeftRight
        ? 'left'
        : 'right';

    const tracker = targetSide === 'left' ? this.leftTracker : this.rightTracker;
    this.updateFootTracker(tracker, sample);
    this.notify();
  }

  private updateFootTracker(tracker: InternalFootTracker, sample: CalibratedSample): void {
    const st = tracker.state;
    st.latestSample = sample;

    // Compute time step dt in seconds (expected ~0.0102s at 98 Hz)
    let dt = 0.0102;
    if (tracker.lastTimestamp > 0) {
      const elapsedSec = (sample.timestamp - tracker.lastTimestamp) / 1000.0;
      if (elapsedSec > 0.001 && elapsedSec < 0.25) {
        dt = elapsedSec;
      }
    }
    tracker.lastTimestamp = sample.timestamp;

    // 1. Rotate calibrated acceleration (in g) into world frame
    const worldG = rotateAccelToWorld(
      sample.accel.x,
      sample.accel.y,
      sample.accel.z,
      sample.euler.pitch,
      sample.euler.roll,
      sample.euler.yaw
    );

    if (!tracker.gravityInitialized) {
      tracker.worldGravityBaseline = { ...worldG };
      tracker.gravityInitialized = true;
    }

    // 2. ZUPT Detector (Zero-Velocity Update)
    // Check if foot is stationary on ground: low angular velocity AND acceleration close to 1.0g
    const gyroMag = sample.gyroMagnitude;
    const accelDevFrom1G = Math.abs(sample.accelMagnitude - 1.0);
    const isInstantStill =
      gyroMag < this.config.gyroThresholdRad && accelDevFrom1G < this.config.accelThresholdG;

    if (isInstantStill) {
      tracker.stanceCounter++;
    } else {
      tracker.stanceCounter = 0;
    }

    const isZuptActive = tracker.stanceCounter >= this.config.stanceFramesRequired;
    st.isStationaryZupt = isZuptActive;

    if (isZuptActive) {
      // Slowly adapt world gravity baseline while foot rests on floor to cancel shoe mount angle bias
      const alpha = 0.08;
      tracker.worldGravityBaseline.x =
        tracker.worldGravityBaseline.x * (1 - alpha) + worldG.x * alpha;
      tracker.worldGravityBaseline.y =
        tracker.worldGravityBaseline.y * (1 - alpha) + worldG.y * alpha;
      tracker.worldGravityBaseline.z =
        tracker.worldGravityBaseline.z * (1 - alpha) + worldG.z * alpha;

      // Check if we just landed from a swing phase
      if (st.phase === 'swing') {
        const dx = st.position.x - tracker.stepStartPos.x;
        const dz = st.position.z - tracker.stepStartPos.z;
        const stepDist = Math.hypot(dx, dz);

        if (
          stepDist >= this.config.minStepDistanceMeters ||
          tracker.peakHeightInSwing >= 0.035
        ) {
          st.stepCount += 1;
          st.lastStepLengthMeters = stepDist;
          st.totalDistanceMeters += stepDist;
          st.avgStepLengthMeters = st.totalDistanceMeters / st.stepCount;
          st.maxStepHeightMeters = Math.max(st.maxStepHeightMeters, tracker.peakHeightInSwing);

          // Update cadence (steps per minute over last 15 seconds)
          const nowMs = sample.timestamp;
          tracker.stepTimestamps.push(nowMs);
          tracker.stepTimestamps = tracker.stepTimestamps.filter((t) => nowMs - t <= 15000);
          if (tracker.stepTimestamps.length >= 2) {
            const spanSec =
              (tracker.stepTimestamps[tracker.stepTimestamps.length - 1] -
                tracker.stepTimestamps[0]) /
              1000.0;
            if (spanSec > 0.2) {
              st.cadenceSpm = Math.round(((tracker.stepTimestamps.length - 1) / spanSec) * 60);
            }
          }

          // Place footprint marker on 3D floor
          this.footprints = [
            ...this.footprints.slice(-(MAX_FOOTPRINTS - 1)),
            {
              id: this.footprintIdSeq++,
              side: st.side,
              x: st.position.x,
              z: st.position.z,
              yawDeg: sample.euler.yaw,
              timestamp: sample.timestamp,
              stepLengthMeters: stepDist,
            },
          ];
        }
      }

      // Apply ZUPT: Zero velocity & ground height clamping
      st.phase = 'stance';
      tracker.swingCounter = 0;
      tracker.peakHeightInSwing = 0;
      st.velocity.x = 0;
      st.velocity.y = 0;
      st.velocity.z = 0;
      st.worldAccel = { x: 0, y: 0, z: 0 };
      st.speedMps = 0;
      st.position.y = st.position.y * 0.65; // smooth settle to floor y=0
      if (st.position.y < 0.002) st.position.y = 0;
      st.currentLiftHeightMeters = st.position.y;
      tracker.stepStartPos = { ...st.position };
    } else {
      // SWING PHASE: Foot is moving in space
      if (st.phase === 'stance') {
        st.phase = 'swing';
        tracker.stepStartPos = { ...st.position };
        tracker.peakHeightInSwing = 0;
        tracker.swingCounter = 0;
      }
      tracker.swingCounter++;

      // Linear world acceleration in m/s^2 (subtracting calibrated gravity baseline)
      let axMps2 = (worldG.x - tracker.worldGravityBaseline.x) * GRAVITY_MPS2;
      let ayMps2 = (worldG.y - tracker.worldGravityBaseline.y) * GRAVITY_MPS2;
      let azMps2 = (worldG.z - tracker.worldGravityBaseline.z) * GRAVITY_MPS2;

      // Apply deadband to linear acceleration to prevent micro-noise accumulation
      if (Math.abs(axMps2) < 0.25) axMps2 = 0;
      if (Math.abs(ayMps2) < 0.25) ayMps2 = 0;
      if (Math.abs(azMps2) < 0.25) azMps2 = 0;

      st.worldAccel = { x: axMps2, y: ayMps2, z: azMps2 };

      // Integrate velocity with damping factor (prevents runaway if foot held in air > 2s)
      const damp = this.config.velocityDamping;
      st.velocity.x = (st.velocity.x + axMps2 * dt) * damp;
      st.velocity.y = (st.velocity.y + ayMps2 * dt) * damp;
      st.velocity.z = (st.velocity.z + azMps2 * dt) * damp;

      // Clamp realistic human foot velocity (~6.5 m/s max)
      st.velocity.x = Math.max(-6.5, Math.min(6.5, st.velocity.x));
      st.velocity.y = Math.max(-4.5, Math.min(4.5, st.velocity.y));
      st.velocity.z = Math.max(-6.5, Math.min(6.5, st.velocity.z));

      st.speedMps = Math.hypot(st.velocity.x, st.velocity.y, st.velocity.z);

      // Integrate position
      st.position.x += st.velocity.x * dt;
      st.position.y = Math.max(0, st.position.y + st.velocity.y * dt);
      st.position.z += st.velocity.z * dt;

      st.currentLiftHeightMeters = st.position.y;
      if (st.position.y > tracker.peakHeightInSwing) {
        tracker.peakHeightInSwing = st.position.y;
      }
      if (tracker.peakHeightInSwing > st.maxStepHeightMeters) {
        st.maxStepHeightMeters = tracker.peakHeightInSwing;
      }

      // Append to 3D trajectory ribbon if moved >= 1.2 cm from last trail vertex
      const lastPt = st.trail[st.trail.length - 1];
      const distFromLast = lastPt
        ? Math.hypot(
            st.position.x - lastPt.x,
            st.position.y - lastPt.y,
            st.position.z - lastPt.z
          )
        : 999;

      if (distFromLast >= 0.012) {
        st.trail = [
          ...st.trail.slice(-(MAX_TRAIL_POINTS - 1)),
          { x: st.position.x, y: st.position.y, z: st.position.z },
        ];
      }
    }
  }
}

export const footKinematics = new DualFootKinematicsEngine();
