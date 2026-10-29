/**
 * Dual-Foot 3D Spatial Motion Tracker (2x Physical Triki BLE + ZUPT INS)
 * Connects two physical Żabka Triki (CAP001) pucks mounted on Left and Right shoes.
 * Features:
 * - Physical Triki hardware accuracy: Center button at (0,0), single GREEN LED on +Y axis
 * - Real-time ZUPT (Zero-Velocity Update) drift elimination during stance phase
 * - 3D trajectory ribbons, floor footprint markers, step length, lift height & cadence
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BLEConnectionState,
  FootKinematicState,
  FootprintMarker,
  ThemeMode,
  ZuptConfig,
} from '../types/triki';
import { trikiBle, trikiBleRight } from '../services/bleManager';
import { sensorPipeline, sensorPipelineRight } from '../services/sensorPipeline';
import { footKinematics } from '../services/footKinematics';
import {
  Bluetooth,
  BluetoothOff,
  RotateCcw,
  ArrowLeftRight,
  Lightbulb,
  Footprints,
  Compass,
  Trash2,
  Eye,
  Sliders,
} from 'lucide-react';

interface DualFootTrackerProps {
  theme: ThemeMode;
  onOpenFilterSettings?: () => void;
}

type VisualModelMode = 'shoe-puck' | 'puck-only';
type CameraViewMode = 'follow' | 'top-down' | 'orbit';

interface FootActorRefs {
  rootGroup: THREE.Group;
  shoeGroup: THREE.Group;
  puckGroup: THREE.Group;
  buttonMesh: THREE.Mesh;
  greenLedMesh: THREE.Mesh;
  stanceRingMesh: THREE.Mesh;
  axesHelper: THREE.AxesHelper;
}

/**
 * Helper to build a multi-part procedural Shoe + Triki Puck (with center button and Green LED on +Y axis)
 */
function createFootActor(side: 'left' | 'right', isEink: boolean): FootActorRefs {
  const rootGroup = new THREE.Group();

  // 1. Stance ZUPT Ground Indicator Ring (sits flat on floor under foot)
  const stanceRingGeo = new THREE.RingGeometry(0.14, 0.175, 36);
  const stanceRingMat = new THREE.MeshBasicMaterial({
    color: isEink ? 0x111111 : side === 'left' ? 0x0284c7 : 0x10b981,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  stanceRingMat.polygonOffset = true;
  stanceRingMat.polygonOffsetFactor = -1;
  stanceRingMat.polygonOffsetUnits = -1;
  const stanceRingMesh = new THREE.Mesh(stanceRingGeo, stanceRingMat);
  stanceRingMesh.rotation.x = -Math.PI / 2;
  stanceRingMesh.position.y = 0.003;
  rootGroup.add(stanceRingMesh);

  // 2. Procedural Athletic Shoe (Composite Group, pivoted at bottom sole y=0, pointing toward -Z)
  const shoeGroup = new THREE.Group();
  const shoeAccentColor = isEink ? 0x333333 : side === 'left' ? 0x0284c7 : 0x059669;

  const soleMat = new THREE.MeshStandardMaterial({
    color: isEink ? 0xe5e5e0 : 0xf1f5f9,
    roughness: 0.85,
    metalness: 0.05,
  });
  const upperMat = new THREE.MeshStandardMaterial({
    color: isEink ? 0xd4d4ce : 0x1e293b,
    roughness: 0.6,
    metalness: 0.15,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: shoeAccentColor,
    roughness: 0.35,
    metalness: 0.25,
  });

  // Part A: Outsole base
  const soleGeo = new THREE.BoxGeometry(0.11, 0.024, 0.27);
  const soleMesh = new THREE.Mesh(soleGeo, soleMat);
  soleMesh.position.set(0, 0.012, -0.01);
  soleMesh.castShadow = true;
  soleMesh.receiveShadow = true;
  shoeGroup.add(soleMesh);

  // Part B: Rounded Toe Cap (at -Z forward)
  const toeGeo = new THREE.CylinderGeometry(0.054, 0.055, 0.024, 24);
  const toeMesh = new THREE.Mesh(toeGeo, soleMat);
  toeMesh.position.set(0, 0.012, -0.145);
  toeMesh.castShadow = true;
  shoeGroup.add(toeMesh);

  // Part C: Forefoot & Midfoot Upper Vamp
  const vampGeo = new THREE.BoxGeometry(0.102, 0.048, 0.18);
  const vampMesh = new THREE.Mesh(vampGeo, upperMat);
  vampMesh.position.set(0, 0.044, -0.03);
  vampMesh.rotation.x = 0.12;
  vampMesh.castShadow = true;
  shoeGroup.add(vampMesh);

  // Part D: Heel Counter & Ankle Collar
  const heelGeo = new THREE.CylinderGeometry(0.048, 0.052, 0.075, 24);
  const heelMesh = new THREE.Mesh(heelGeo, upperMat);
  heelMesh.position.set(0, 0.058, 0.085);
  heelMesh.castShadow = true;
  shoeGroup.add(heelMesh);

  // Part E: Lateral Side Accent Stripe & Instep Mounting Strap
  const strapGeo = new THREE.BoxGeometry(0.108, 0.012, 0.065);
  const strapMesh = new THREE.Mesh(strapGeo, trimMat);
  strapMesh.position.set(0, 0.068, -0.035);
  shoeGroup.add(strapMesh);

  rootGroup.add(shoeGroup);

  // 3. Physical Żabka Triki Puck (CAP001) mounted on the shoe instep
  // Accurate hardware layout:
  // - Button in the exact center (0, 0)
  // - Single Green LED located on the +Y axis (pointing forward along -Z of the foot)
  const puckGroup = new THREE.Group();
  puckGroup.position.set(0, 0.086, -0.035);

  const puckScale = 0.048; // Physical scale (~6cm diameter puck on a 27cm shoe)

  const hullMat = new THREE.MeshStandardMaterial({
    color: isEink ? 0xf5f5f2 : 0x0f172a,
    metalness: 0.25,
    roughness: 0.35,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: isEink ? 0xcfcfc8 : 0x1e293b,
    metalness: 0.1,
    roughness: 0.8,
  });
  const buttonMat = new THREE.MeshStandardMaterial({
    color: isEink ? 0xe2e2dc : 0x334155,
    metalness: 0.35,
    roughness: 0.4,
  });
  const greenLedMat = new THREE.MeshStandardMaterial({
    color: isEink ? 0x333333 : 0x22c55e,
    emissive: isEink ? 0x000000 : 0x22c55e,
    emissiveIntensity: isEink ? 0.1 : 1.8,
    roughness: 0.15,
    metalness: 0.1,
  });

  // Puck Hull
  const hullMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25 * puckScale, 1.25 * puckScale, 0.45 * puckScale, 40),
    hullMat
  );
  hullMesh.castShadow = true;
  puckGroup.add(hullMesh);

  // Puck Grip Ring
  const gripMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.28 * puckScale, 1.28 * puckScale, 0.26 * puckScale, 40),
    gripMat
  );
  gripMesh.position.y = 0.02 * puckScale;
  puckGroup.add(gripMesh);

  // Center Tactile Button at (0, 0)
  const buttonMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.66 * puckScale, 0.66 * puckScale, 0.14 * puckScale, 32),
    buttonMat
  );
  buttonMesh.position.set(0, 0.22 * puckScale, 0);
  puckGroup.add(buttonMesh);

  // Single Green LED on +Y axis (forward along -Z)
  const ledBezelMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * puckScale, 0.2 * puckScale, 0.05 * puckScale, 20),
    gripMat
  );
  ledBezelMesh.position.set(0, 0.23 * puckScale, -0.95 * puckScale);
  puckGroup.add(ledBezelMesh);

  const greenLedMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.14 * puckScale, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    greenLedMat
  );
  greenLedMesh.position.set(0, 0.24 * puckScale, -0.95 * puckScale);
  puckGroup.add(greenLedMesh);

  // +Y Axis Direction Arrow on top of puck pointing from center through the green LED
  const yArrowGeo = new THREE.ConeGeometry(0.12 * puckScale, 0.28 * puckScale, 12);
  const yArrowMat = new THREE.MeshBasicMaterial({
    color: isEink ? 0x111111 : 0x22c55e,
  });
  const yArrowMesh = new THREE.Mesh(yArrowGeo, yArrowMat);
  yArrowMesh.rotation.x = -Math.PI / 2;
  yArrowMesh.position.set(0, 0.24 * puckScale, -1.35 * puckScale);
  puckGroup.add(yArrowMesh);

  // Local Coordinate Axes
  const axesHelper = new THREE.AxesHelper(0.18);
  axesHelper.position.y = 0.02;
  puckGroup.add(axesHelper);

  rootGroup.add(puckGroup);

  return {
    rootGroup,
    shoeGroup,
    puckGroup,
    buttonMesh,
    greenLedMesh,
    stanceRingMesh,
    axesHelper,
  };
}

export const DualFootTracker: React.FC<DualFootTrackerProps> = ({
  theme,
  onOpenFilterSettings,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // BLE states for Primary (#1) and Secondary (#2) pucks
  const [bleState1, setBleState1] = useState<BLEConnectionState>(trikiBle.getState());
  const [bleState2, setBleState2] = useState<BLEConnectionState>(trikiBleRight.getState());

  // Kinematic states for Left & Right feet
  const [leftFoot, setLeftFoot] = useState<FootKinematicState>(footKinematics.getFootState('left'));
  const [rightFoot, setRightFoot] = useState<FootKinematicState>(footKinematics.getFootState('right'));
  const [footprints, setFootprints] = useState<FootprintMarker[]>(footKinematics.getFootprints());
  const [isSwapped, setIsSwapped] = useState<boolean>(footKinematics.isSwapped());
  const [zuptConfig, setZuptConfig] = useState<ZuptConfig>(footKinematics.getConfig());

  // 3D Viewport Controls
  const [visualMode, setVisualMode] = useState<VisualModelMode>('shoe-puck');
  const [cameraMode, setCameraMode] = useState<CameraViewMode>('follow');
  const [showAxes, setShowAxes] = useState<boolean>(true);
  const [dockExpanded, setDockExpanded] = useState<boolean>(true);

  const visualModeRef = useRef<VisualModelMode>(visualMode);
  visualModeRef.current = visualMode;
  const cameraModeRef = useRef<CameraViewMode>(cameraMode);
  cameraModeRef.current = cameraMode;
  const showAxesRef = useRef<boolean>(showAxes);
  showAxesRef.current = showAxes;
  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;

  // Subscribe to both BLE managers, pipelines, and footKinematics engine
  useEffect(() => {
    const unsubState1 = trikiBle.onStateChange((st) => setBleState1({ ...st }));
    const unsubState2 = trikiBleRight.onStateChange((st) => setBleState2({ ...st }));

    // Primary BLE (#1) is already processed by sensorPipeline in App.tsx,
    // so we subscribe to sensorPipeline output to avoid double-processing
    const unsubSample1 = sensorPipeline.subscribe((calibrated) => {
      footKinematics.processChannelSample('primary', calibrated);
    });

    // Secondary BLE (#2) raw packets feed sensorPipelineRight
    const unsubRaw2 = trikiBleRight.onPacket((raw) => {
      const calibrated2 = sensorPipelineRight.processRawSample(raw);
      footKinematics.processChannelSample('secondary', calibrated2);
    });

    const unsubKinematics = footKinematics.subscribe(() => {
      setLeftFoot({ ...footKinematics.getFootState('left') });
      setRightFoot({ ...footKinematics.getFootState('right') });
      setFootprints([...footKinematics.getFootprints()]);
      setIsSwapped(footKinematics.isSwapped());
      setZuptConfig(footKinematics.getConfig());
    });

    return () => {
      unsubState1();
      unsubState2();
      unsubSample1();
      unsubRaw2();
      unsubKinematics();
    };
  }, []);

  // Initialize Three.js Dual-Foot 3D Spatial Arena
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const isEink = themeRef.current === 'eink';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isEink ? 0xf5f5f0 : 0xf8fafc);
    scene.fog = new THREE.Fog(isEink ? 0xf5f5f0 : 0xf8fafc, 4.5, 16);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 40);
    camera.position.set(0, 1.45, 1.65);
    camera.lookAt(0, 0.05, -0.15);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Studio Environment Reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.7);
    keyLight.position.set(2.5, 5.0, 2.5);
    keyLight.castShadow = !isSoftwareGl;
    if (keyLight.shadow) {
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 15;
      keyLight.shadow.camera.left = -2.5;
      keyLight.shadow.camera.right = 2.5;
      keyLight.shadow.camera.top = 2.5;
      keyLight.shadow.camera.bottom = -2.5;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
    rimLight.position.set(-2.5, 2.5, -2.5);
    scene.add(rimLight);

    // Metric Ground Grid & Shadow Floor
    const floorGeo = new THREE.PlaneGeometry(24, 24);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Sub-grid (0.25m subdivisions) + Major grid (1.0m subdivisions)
    const subGrid = new THREE.GridHelper(
      12,
      48,
      isEink ? 0x666666 : 0x94a3b8,
      isEink ? 0xd4d4ce : 0xe2e8f0
    );
    subGrid.position.y = 0.001;
    scene.add(subGrid);

    // Origin starting line marker (0,0,0)
    const originBarGeo = new THREE.PlaneGeometry(0.65, 0.025);
    const originBarMat = new THREE.MeshBasicMaterial({
      color: isEink ? 0x000000 : 0x475569,
      side: THREE.DoubleSide,
    });
    const originBar = new THREE.Mesh(originBarGeo, originBarMat);
    originBar.rotation.x = -Math.PI / 2;
    originBar.position.set(0, 0.002, 0);
    scene.add(originBar);

    // Create Left & Right Foot 3D Composite Actors
    const leftActor = createFootActor('left', isEink);
    const rightActor = createFootActor('right', isEink);
    scene.add(leftActor.rootGroup);
    scene.add(rightActor.rootGroup);

    // 3D Trajectory Lines for Left & Right Foot
    const maxPts = 320;
    const leftTrailPositions = new Float32Array(maxPts * 3);
    const leftTrailGeo = new THREE.BufferGeometry();
    leftTrailGeo.setAttribute('position', new THREE.BufferAttribute(leftTrailPositions, 3));
    const leftTrailMat = new THREE.LineBasicMaterial({
      color: isEink ? 0x000000 : 0x0284c7,
      linewidth: 2,
    });
    const leftTrailLine = new THREE.Line(leftTrailGeo, leftTrailMat);
    leftTrailLine.frustumCulled = false;
    scene.add(leftTrailLine);

    const rightTrailPositions = new Float32Array(maxPts * 3);
    const rightTrailGeo = new THREE.BufferGeometry();
    rightTrailGeo.setAttribute('position', new THREE.BufferAttribute(rightTrailPositions, 3));
    const rightTrailMat = new THREE.LineBasicMaterial({
      color: isEink ? 0x444444 : 0x10b981,
      linewidth: 2,
    });
    const rightTrailLine = new THREE.Line(rightTrailGeo, rightTrailMat);
    rightTrailLine.frustumCulled = false;
    scene.add(rightTrailLine);

    // Footprint Markers Group on Floor
    const footprintsGroup = new THREE.Group();
    scene.add(footprintsGroup);
    const fpGeo = new THREE.RingGeometry(0.032, 0.055, 24);
    const fpMatLeft = new THREE.MeshBasicMaterial({
      color: isEink ? 0x000000 : 0x0284c7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const fpMatRight = new THREE.MeshBasicMaterial({
      color: isEink ? 0x555555 : 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    // Interactive Camera Orbit Drag
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let orbitYaw = 0;
    let orbitPitch = 0.55;
    let orbitDist = 2.1;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      orbitYaw -= dx * 0.008;
      orbitPitch = Math.max(0.12, Math.min(1.48, orbitPitch + dy * 0.008));
    };
    const onPointerUp = () => {
      isDragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitDist = Math.max(0.8, Math.min(8.0, orbitDist + e.deltaY * 0.0015));
    };

    const domElem = renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domElem.addEventListener('wheel', onWheel, { passive: false });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // Reusable pre-allocated math objects (Zero GC in render loop)
    const _targetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const _targetQuat = new THREE.Quaternion();
    const _camTarget = new THREE.Vector3(0, 0.05, 0);
    const _desiredCamPos = new THREE.Vector3();
    let lastFootprintCount = -1;
    let frameId = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const updateActorFromState = (
      actor: FootActorRefs,
      footState: FootKinematicState,
      isLedLit: boolean,
      mode: VisualModelMode
    ) => {
      // Toggle shoe vs puck-only mode
      if (mode === 'puck-only') {
        actor.shoeGroup.visible = false;
        actor.puckGroup.position.set(0, 0.03, 0);
        actor.puckGroup.scale.setScalar(1.85);
      } else {
        actor.shoeGroup.visible = true;
        actor.puckGroup.position.set(0, 0.086, -0.035);
        actor.puckGroup.scale.setScalar(1.0);
      }

      actor.axesHelper.visible = showAxesRef.current;

      // Smoothly damp position to kinematic world position (meters)
      actor.rootGroup.position.lerp(
        _desiredCamPos.set(footState.position.x, footState.position.y, footState.position.z),
        0.45
      );

      // Apply 3D orientation from IMU Euler angles
      const sample = footState.latestSample;
      if (sample && sample.euler) {
        const radPitch = THREE.MathUtils.degToRad(-sample.euler.pitch);
        const radYaw = THREE.MathUtils.degToRad(-sample.euler.yaw);
        const radRoll = THREE.MathUtils.degToRad(-sample.euler.roll);
        _targetEuler.set(radPitch, radYaw, radRoll, 'YXZ');
        _targetQuat.setFromEuler(_targetEuler);
        actor.rootGroup.quaternion.slerp(_targetQuat, 0.4);
      }

      // Center button depression feedback
      const isPressed = Boolean(sample?.button);
      const puckScale = 0.048;
      actor.buttonMesh.position.y = (isPressed ? 0.14 : 0.22) * puckScale;

      // Green LED on +Y axis state feedback
      const ledMat = actor.greenLedMesh.material as THREE.MeshStandardMaterial;
      if (isLedLit) {
        ledMat.color.setHex(themeRef.current === 'eink' ? 0x111111 : 0x22c55e);
        ledMat.emissive.setHex(themeRef.current === 'eink' ? 0x000000 : 0x22c55e);
        ledMat.emissiveIntensity = themeRef.current === 'eink' ? 0.5 : 3.5;
      } else {
        ledMat.color.setHex(themeRef.current === 'eink' ? 0x777777 : 0x15803d);
        ledMat.emissive.setHex(themeRef.current === 'eink' ? 0x000000 : 0x16a34a);
        ledMat.emissiveIntensity = 0.25;
      }

      // Stance ZUPT ring visibility (visible when foot is anchored on floor)
      actor.stanceRingMesh.visible = footState.isStationaryZupt;
    };

    const updateTrailGeometry = (
      lineGeo: THREE.BufferGeometry,
      positionsArr: Float32Array,
      trail: { x: number; y: number; z: number }[]
    ) => {
      const count = Math.min(trail.length, maxPts);
      for (let i = 0; i < count; i++) {
        const pt = trail[i];
        positionsArr[i * 3] = pt.x;
        positionsArr[i * 3 + 1] = Math.max(0.004, pt.y);
        positionsArr[i * 3 + 2] = pt.z;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.setDrawRange(0, count);
    };

    const tick = () => {
      const lState = footKinematics.getFootState('left');
      const rState = footKinematics.getFootState('right');
      const swapped = footKinematics.isSwapped();

      const leftLedOn = swapped ? trikiBleRight.getIsLedOn() : trikiBle.getIsLedOn();
      const rightLedOn = swapped ? trikiBle.getIsLedOn() : trikiBleRight.getIsLedOn();

      updateActorFromState(leftActor, lState, leftLedOn, visualModeRef.current);
      updateActorFromState(rightActor, rState, rightLedOn, visualModeRef.current);

      updateTrailGeometry(leftTrailGeo, leftTrailPositions, lState.trail);
      updateTrailGeometry(rightTrailGeo, rightTrailPositions, rState.trail);

      // Rebuild floor footprints if count changed
      const currentFps = footKinematics.getFootprints();
      if (currentFps.length !== lastFootprintCount) {
        lastFootprintCount = currentFps.length;
        while (footprintsGroup.children.length > 0) {
          footprintsGroup.remove(footprintsGroup.children[0]);
        }
        for (const fp of currentFps) {
          const m = new THREE.Mesh(fpGeo, fp.side === 'left' ? fpMatLeft : fpMatRight);
          m.rotation.x = -Math.PI / 2;
          m.position.set(fp.x, 0.0025, fp.z);
          footprintsGroup.add(m);
        }
      }

      // Camera Choreography (Follow midpoint of feet / Top-Down / Orbit)
      const midX = (lState.position.x + rState.position.x) * 0.5;
      const midY = (lState.position.y + rState.position.y) * 0.5;
      const midZ = (lState.position.z + rState.position.z) * 0.5;

      _camTarget.lerp(_desiredCamPos.set(midX, midY + 0.06, midZ), 0.12);

      if (cameraModeRef.current === 'top-down') {
        _desiredCamPos.set(_camTarget.x, 3.2, _camTarget.z + 0.01);
        camera.position.lerp(_desiredCamPos, 0.12);
        camera.lookAt(_camTarget);
      } else {
        const camX = _camTarget.x + orbitDist * Math.sin(orbitYaw) * Math.cos(orbitPitch);
        const camZ = _camTarget.z + orbitDist * Math.cos(orbitYaw) * Math.cos(orbitPitch);
        const camY = Math.max(0.15, _camTarget.y + orbitDist * Math.sin(orbitPitch));
        _desiredCamPos.set(camX, camY, camZ);
        camera.position.lerp(_desiredCamPos, 0.15);
        camera.lookAt(_camTarget);
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      domElem.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domElem.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (container.contains(domElem)) {
        container.removeChild(domElem);
      }
    };
  }, []);

  // Handlers for BLE Slot #1 and Slot #2
  const leftBle = isSwapped ? trikiBleRight : trikiBle;
  const rightBle = isSwapped ? trikiBle : trikiBleRight;
  const leftBleState = isSwapped ? bleState2 : bleState1;
  const rightBleState = isSwapped ? bleState1 : bleState2;

  const handleConnectFoot = async (side: 'left' | 'right') => {
    const manager = side === 'left' ? leftBle : rightBle;
    const st = side === 'left' ? leftBleState : rightBleState;
    try {
      if (st.status === 'connected') {
        manager.disconnect();
      } else {
        await manager.connect();
      }
    } catch (err) {
      console.warn(`BLE Foot (${side}) connection error:`, err);
    }
  };

  const handleToggleFootLed = async (side: 'left' | 'right') => {
    const manager = side === 'left' ? leftBle : rightBle;
    await manager.toggleLed(!manager.getIsLedOn());
  };

  const handleBlinkFootLed = async (side: 'left' | 'right') => {
    const manager = side === 'left' ? leftBle : rightBle;
    await manager.testBlink(3);
  };

  const handleSendStartFoot = async (side: 'left' | 'right') => {
    const manager = side === 'left' ? leftBle : rightBle;
    await manager.sendStartCommand();
  };

  const handleCalibrateAndZeroFeet = () => {
    sensorPipeline.startCalibration(120);
    sensorPipelineRight.startCalibration(120);
    sensorPipeline.resetOrientation();
    sensorPipelineRight.resetOrientation();
    footKinematics.resetAll();
  };

  const handleSwapFeet = () => {
    footKinematics.toggleSwapSides();
  };

  const isEink = theme === 'eink';
  const totalSteps = leftFoot.stepCount + rightFoot.stepCount;
  const totalDistance = leftFoot.totalDistanceMeters + rightFoot.totalDistanceMeters;
  const avgStepLength =
    totalSteps > 0 ? totalDistance / totalSteps : 0;
  const maxLiftCm =
    Math.max(leftFoot.maxStepHeightMeters, rightFoot.maxStepHeightMeters) * 100;
  const combinedCadence = Math.max(leftFoot.cadenceSpm, rightFoot.cadenceSpm) * 2;

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: Dual-BLE Foot Pairing & Hardware Control Cards (Left Foot + Swap + Right Foot) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        {/* Left Foot BLE Slot (5 cols) */}
        <div
          className={`lg:col-span-5 rounded-xl border p-3.5 flex flex-col justify-between gap-3 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-bold tracking-tight ${
                    isEink ? 'text-black' : 'text-sky-700'
                  }`}
                >
                  Lewa Stopa (L)
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  · {leftBleState.deviceName || 'Kapsel Triki #1'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5 tabular-nums">
                Status:{' '}
                <strong
                  className={
                    leftBleState.status === 'connected'
                      ? 'text-emerald-600'
                      : 'text-slate-600'
                  }
                >
                  {leftBleState.status === 'connected' ? 'POŁĄCZONO' : 'ROZŁĄCZONO'}
                </strong>
                {' · '}
                {leftBleState.packetRateHz.toFixed(1)} Hz
                {' · '}
                {leftBleState.packetsReceived} pkt
              </div>
            </div>

            <button
              onClick={() => handleConnectFoot('left')}
              disabled={
                leftBleState.status === 'searching' || leftBleState.status === 'connecting'
              }
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] cursor-pointer ${
                leftBleState.status === 'connected'
                  ? isEink
                    ? 'border-2 border-black bg-zinc-200 text-black font-bold'
                    : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                  : isEink
                  ? 'border-2 border-black bg-white text-black hover:bg-zinc-100 font-bold'
                  : 'bg-sky-600 text-white hover:bg-sky-700 shadow-xs'
              }`}
            >
              {leftBleState.status === 'connected' ? (
                <>
                  <BluetoothOff className="w-3.5 h-3.5" />
                  <span>Rozłącz L</span>
                </>
              ) : (
                <>
                  <Bluetooth className="w-3.5 h-3.5" />
                  <span>Połącz Lewą Stopę</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] font-mono flex-wrap">
            <div className="flex items-center gap-2 tabular-nums">
              <span>
                Faza:{' '}
                <strong
                  className={
                    leftFoot.isStationaryZupt ? 'text-emerald-600' : 'text-amber-600'
                  }
                >
                  {leftFoot.isStationaryZupt ? 'PODPÓR (ZUPT 0m/s)' : 'W RUCHU (SWING)'}
                </strong>
              </span>
              <span>·</span>
              <span>
                Przycisk: {leftFoot.latestSample?.button ? '● WCIŚNIĘTY' : '○ PUSZCZONY'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleToggleFootLed('left')}
                disabled={leftBleState.status !== 'connected'}
                className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                  leftBleState.ledEnabled
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                title="Włącz/wyłącz fizyczną zieloną diodę LED na osi Y lewego kapsla"
              >
                <Lightbulb className="w-3 h-3" />
                <span>Zielona LED: {leftBleState.ledEnabled ? 'ON' : 'OFF'}</span>
              </button>
              <button
                onClick={() => handleBlinkFootLed('left')}
                disabled={leftBleState.status !== 'connected'}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] cursor-pointer disabled:opacity-40"
                title="Mignij 3 razy zieloną diodą LED lewego kapsla"
              >
                Blink 3x
              </button>
              {leftBleState.status === 'connected' && (
                <button
                  onClick={() => handleSendStartFoot('left')}
                  className="px-2 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 text-[11px] font-semibold cursor-pointer"
                  title="Wyślij komendę START do lewego kapsla"
                >
                  ▶ START
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Center Swap & Zeroing Control Column (2 cols) */}
        <div
          className={`lg:col-span-2 rounded-xl border p-3 flex flex-col items-center justify-center gap-2 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-xs'
          }`}
        >
          <button
            onClick={handleSwapFeet}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer min-h-[38px] ${
              isSwapped
                ? isEink
                  ? 'border-2 border-black bg-zinc-200 text-black font-bold'
                  : 'bg-indigo-50 border-indigo-300 text-indigo-800'
                : isEink
                ? 'border border-black bg-white text-black hover:bg-zinc-100'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
            title="Zamień przypisanie kapsli Lewa Stopa ⇄ Prawa Stopa bez rozłączania Bluetooth"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Zamień L ⇄ P</span>
          </button>

          <button
            onClick={handleCalibrateAndZeroFeet}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer min-h-[38px] ${
              isEink
                ? 'border-2 border-black bg-white text-black hover:bg-zinc-100 font-bold'
                : 'bg-slate-900 text-white hover:bg-slate-800 shadow-xs'
            }`}
            title="Kalibruje spoczynkowe 1g, taruje kąty obu kapsli i ustawia stopy w punkcie (0,0,0)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Zeruj Stopy (0,0)</span>
          </button>
        </div>

        {/* Right Foot BLE Slot (5 cols) */}
        <div
          className={`lg:col-span-5 rounded-xl border p-3.5 flex flex-col justify-between gap-3 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-bold tracking-tight ${
                    isEink ? 'text-black' : 'text-emerald-700'
                  }`}
                >
                  Prawa Stopa (P)
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  · {rightBleState.deviceName || 'Kapsel Triki #2'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5 tabular-nums">
                Status:{' '}
                <strong
                  className={
                    rightBleState.status === 'connected'
                      ? 'text-emerald-600'
                      : 'text-slate-600'
                  }
                >
                  {rightBleState.status === 'connected' ? 'POŁĄCZONO' : 'ROZŁĄCZONO'}
                </strong>
                {' · '}
                {rightBleState.packetRateHz.toFixed(1)} Hz
                {' · '}
                {rightBleState.packetsReceived} pkt
              </div>
            </div>

            <button
              onClick={() => handleConnectFoot('right')}
              disabled={
                rightBleState.status === 'searching' || rightBleState.status === 'connecting'
              }
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] cursor-pointer ${
                rightBleState.status === 'connected'
                  ? isEink
                    ? 'border-2 border-black bg-zinc-200 text-black font-bold'
                    : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                  : isEink
                  ? 'border-2 border-black bg-white text-black hover:bg-zinc-100 font-bold'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
              }`}
            >
              {rightBleState.status === 'connected' ? (
                <>
                  <BluetoothOff className="w-3.5 h-3.5" />
                  <span>Rozłącz P</span>
                </>
              ) : (
                <>
                  <Bluetooth className="w-3.5 h-3.5" />
                  <span>Połącz Prawą Stopę</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] font-mono flex-wrap">
            <div className="flex items-center gap-2 tabular-nums">
              <span>
                Faza:{' '}
                <strong
                  className={
                    rightFoot.isStationaryZupt ? 'text-emerald-600' : 'text-amber-600'
                  }
                >
                  {rightFoot.isStationaryZupt ? 'PODPÓR (ZUPT 0m/s)' : 'W RUCHU (SWING)'}
                </strong>
              </span>
              <span>·</span>
              <span>
                Przycisk: {rightFoot.latestSample?.button ? '● WCIŚNIĘTY' : '○ PUSZCZONY'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleToggleFootLed('right')}
                disabled={rightBleState.status !== 'connected'}
                className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                  rightBleState.ledEnabled
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                title="Włącz/wyłącz fizyczną zieloną diodę LED na osi Y prawego kapsla"
              >
                <Lightbulb className="w-3 h-3" />
                <span>Zielona LED: {rightBleState.ledEnabled ? 'ON' : 'OFF'}</span>
              </button>
              <button
                onClick={() => handleBlinkFootLed('right')}
                disabled={rightBleState.status !== 'connected'}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] cursor-pointer disabled:opacity-40"
                title="Mignij 3 razy zieloną diodą LED prawego kapsla"
              >
                Blink 3x
              </button>
              {rightBleState.status === 'connected' && (
                <button
                  onClick={() => handleSendStartFoot('right')}
                  className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-[11px] font-semibold cursor-pointer"
                  title="Wyślij komendę START do prawego kapsla"
                >
                  ▶ START
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: 4-Column Gait & Spatial Telemetry Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono tabular-nums">
        <div
          className={`rounded-xl border p-3.5 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-2xs'
          }`}
        >
          <div className="text-xs text-slate-500 font-sans">Kroki łącznie (L + P)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{totalSteps}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Lewa: {leftFoot.stepCount} · Prawa: {rightFoot.stepCount} · Ślady: {footprints.length}
          </div>
        </div>

        <div
          className={`rounded-xl border p-3.5 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-2xs'
          }`}
        >
          <div className="text-xs text-slate-500 font-sans">Długość kroku i dystans</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {(avgStepLength * 100).toFixed(0)} cm
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Ostatni L: {(leftFoot.lastStepLengthMeters * 100).toFixed(0)} cm · P:{' '}
            {(rightFoot.lastStepLengthMeters * 100).toFixed(0)} cm · Dystans:{' '}
            {totalDistance.toFixed(2)} m
          </div>
        </div>

        <div
          className={`rounded-xl border p-3.5 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-2xs'
          }`}
        >
          <div className="text-xs text-slate-500 font-sans">Uniesienie stopy nad podłoże (Oś Y)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {maxLiftCm.toFixed(1)} cm <span className="text-xs font-normal text-slate-400">max</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Teraz L: {(leftFoot.currentLiftHeightMeters * 100).toFixed(1)} cm · P:{' '}
            {(rightFoot.currentLiftHeightMeters * 100).toFixed(1)} cm
          </div>
        </div>

        <div
          className={`rounded-xl border p-3.5 ${
            isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-2xs'
          }`}
        >
          <div className="text-xs text-slate-500 font-sans">Kadencja i prędkość stóp</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {combinedCadence} <span className="text-xs font-normal text-slate-400">kroków/min</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Prędkość L: {leftFoot.speedMps.toFixed(2)} m/s · P: {rightFoot.speedMps.toFixed(2)} m/s
          </div>
        </div>
      </div>

      {/* Row 3: Unobstructed 3D Spatial Foot Arena */}
      <div
        className={`relative w-full h-[460px] sm:h-[540px] rounded-xl border overflow-hidden select-none ${
          isEink ? 'bg-white border-2 border-black' : 'bg-white border-slate-200 shadow-xs'
        }`}
      >
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Top-Left Compact Live Coordinates Overlay (No backdrop-filter over WebGL) */}
        <div
          className={`absolute top-3 left-3 px-3 py-2 rounded-lg border text-[11px] font-mono tabular-nums ${
            isEink
              ? 'bg-white text-black border-black'
              : 'bg-white/95 text-slate-800 border-slate-200 shadow-xs'
          }`}
        >
          <div className="font-bold text-slate-900 mb-1">
            Nawigacja Inercyjna Stóp 3D (ZUPT · Siatka 0.25m)
          </div>
          <div className="flex flex-col gap-0.5">
            <div>
              <strong className={isEink ? 'text-black' : 'text-sky-700'}>Lewa (L):</strong>{' '}
              X={leftFoot.position.x.toFixed(2)}m · Y={leftFoot.position.y.toFixed(2)}m · Z=
              {leftFoot.position.z.toFixed(2)}m · Yaw=
              {leftFoot.latestSample ? leftFoot.latestSample.euler.yaw.toFixed(0) : '0'}°
            </div>
            <div>
              <strong className={isEink ? 'text-black' : 'text-emerald-700'}>Prawa (P):</strong>{' '}
              X={rightFoot.position.x.toFixed(2)}m · Y={rightFoot.position.y.toFixed(2)}m · Z=
              {rightFoot.position.z.toFixed(2)}m · Yaw=
              {rightFoot.latestSample ? rightFoot.latestSample.euler.yaw.toFixed(0) : '0'}°
            </div>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Montaż kapsla na bucie: Przycisk na środku · Zielona dioda LED skierowana w przód (oś +Y)
          </div>
        </div>

        {/* Ergonomic Collapsible Bottom Control Dock */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[96%] max-w-[780px] z-10">
          <div className="flex justify-center mb-1">
            <button
              onClick={() => setDockExpanded(!dockExpanded)}
              className={`text-[11px] font-mono px-3 py-1 rounded-t-md border-t border-x cursor-pointer ${
                isEink
                  ? 'bg-white text-black border-black font-bold'
                  : 'bg-white text-slate-700 border-slate-200 hover:text-slate-900 shadow-xs'
              }`}
            >
              {dockExpanded
                ? '▾ Zwiń panel przestrzeni 3D i ZUPT'
                : '▴ Opcje widoku 3D, kamery i czułości ZUPT'}
            </button>
          </div>

          {dockExpanded && (
            <div
              className={`p-3 rounded-xl border flex flex-col gap-2.5 text-xs ${
                isEink
                  ? 'bg-white border-2 border-black text-black'
                  : 'bg-white text-slate-800 border-slate-200 shadow-md'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {/* Reset & Clear Trail Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleCalibrateAndZeroFeet}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                      isEink
                        ? 'border-2 border-black bg-white text-black hover:bg-zinc-100'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Kalibruj i Zeruj Pozycję (0,0,0)</span>
                  </button>

                  <button
                    onClick={() => footKinematics.clearTrails()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Wyczyść ścieżkę</span>
                  </button>

                  <button
                    onClick={() => setShowAxes(!showAxes)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium cursor-pointer ${
                      showAxes
                        ? 'bg-slate-100 border-slate-300 text-slate-900'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Osie X/Y/Z</span>
                  </button>

                  {onOpenFilterSettings && (
                    <button
                      onClick={onOpenFilterSettings}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Filtry IMU</span>
                    </button>
                  )}
                </div>

                {/* Model Mode Switcher: Shoe + Puck vs Puck Only */}
                <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-200 bg-slate-50 text-[11px]">
                  <button
                    onClick={() => setVisualMode('shoe-puck')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                      visualMode === 'shoe-puck'
                        ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Footprints className="w-3.5 h-3.5" />
                    <span>Buty + Kapsel</span>
                  </button>
                  <button
                    onClick={() => setVisualMode('puck-only')}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                      visualMode === 'puck-only'
                        ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Same Kapsle (LED oś Y)</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Camera View Mode & ZUPT Threshold Tuning */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 flex-wrap text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-semibold text-slate-700">Kamera:</span>
                  {(
                    [
                      { id: 'follow', label: 'Podążaj 3D' },
                      { id: 'top-down', label: 'Rzut z góry (Mapa)' },
                      { id: 'orbit', label: 'Swobodna orbita' },
                    ] as const
                  ).map((cam) => (
                    <button
                      key={cam.id}
                      onClick={() => setCameraMode(cam.id)}
                      className={`px-2 py-1 rounded border cursor-pointer transition-colors ${
                        cameraMode === cam.id
                          ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}
                </div>

                {/* ZUPT Stance Threshold Slider */}
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-slate-600">
                    Próg postoju ZUPT: <strong>{zuptConfig.gyroThresholdRad.toFixed(2)} rad/s</strong>
                  </span>
                  <input
                    type="range"
                    min="0.06"
                    max="0.45"
                    step="0.02"
                    value={zuptConfig.gyroThresholdRad}
                    onChange={(e) =>
                      footKinematics.updateConfig({
                        gyroThresholdRad: parseFloat(e.target.value),
                      })
                    }
                    className="w-28 accent-sky-600 cursor-pointer"
                    title="Wyższy próg łatwiej wykrywa fazę podporu stopy i szybciej zeruje dryft prędkości"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
