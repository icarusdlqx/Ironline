import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
} from 'three';
import type { MechLocation } from '../../schema/common';
import type { Chassis } from '../../schema/chassis';
import type { Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import { buildPreviewModel, previewModelKey, setPreviewHighlights, type PreviewHighlights, type PreviewModel } from './previewModel';
import { PreviewLoop } from './previewLoop';

export interface MechPreviewCallbacks {
  onHoverLocation?: (location: MechLocation | null) => void;
  onSelectLocation?: (location: MechLocation) => void;
  onFailure?: () => void;
}

const EMPTY_COMPATIBLE: ReadonlySet<MechLocation> = new Set();
const CAMERA_DIRECTION = new Vector3(1, 0.62, 1).normalize();

/** Owns one small Three scene; no battlefield state or animation crosses this seam. */
export class MechPreviewRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 0.1, 1_000);
  private readonly turntable = new Object3D();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly hits: Intersection[] = [];
  private readonly raycastMarkers: Object3D[] = [];
  private readonly bounds = new Box3();
  private readonly sphere = new Sphere();
  private readonly loop: PreviewLoop;
  private current: PreviewModel | null = null;
  private callbacks: MechPreviewCallbacks = {};
  private highlights: PreviewHighlights = {
    selected: null,
    hovered: null,
    compatible: EMPTY_COMPATIBLE,
  };
  private pointerLocation: MechLocation | null = null;
  private radius = 10;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly catalog: Catalog,
    reducedMotion: boolean,
  ) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.loop = new PreviewLoop({
      reducedMotion,
      maximumFps: 30,
      draw: this.draw,
    });
    try {
      this.renderer.setClearColor(new Color(0x000000), 0);
      this.renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio ?? 1));
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;

      const canvas = this.renderer.domElement;
      canvas.dataset.testid = 'mech-preview-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Rotating chassis preview');
      canvas.style.display = 'block';
      canvas.style.height = '100%';
      canvas.style.touchAction = 'manipulation';
      canvas.style.width = '100%';
      this.host.appendChild(canvas);

      this.scene.add(this.turntable);
      this.scene.add(new HemisphereLight(0xc8e8ff, 0x182028, 2.2));
      const key = new DirectionalLight(0xffffff, 3.1);
      key.position.set(5, 9, 7);
      this.scene.add(key);
      const rim = new DirectionalLight(0x78b8ff, 1.15);
      rim.position.set(-6, 3, -5);
      this.scene.add(rim);

      this.installObservers();
      this.installPointerEvents();
      this.resize();
      this.loop.setDocumentVisible(this.host.ownerDocument.visibilityState !== 'hidden');
      this.loop.start();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  setMachine(chassis: Chassis, design: Design): void {
    const key = previewModelKey(chassis, design);
    if (key === this.current?.key) return;

    const next = buildPreviewModel(this.catalog, chassis, design);
    try {
      this.bounds.setFromObject(next.model.root);
      this.bounds.getCenter(next.model.root.position).multiplyScalar(-1);
      this.bounds.getBoundingSphere(this.sphere);
      this.radius = Math.max(1, this.sphere.radius);
      setPreviewHighlights(next, this.highlights);
    } catch (error) {
      next.dispose();
      throw error;
    }

    const previous = this.current;
    this.current = next;
    this.raycastMarkers.length = 0;
    this.raycastMarkers.push(...next.markers);
    this.turntable.add(next.model.root);
    this.setPointerLocation(null);
    if (previous !== null) {
      this.turntable.remove(previous.model.root);
      previous.dispose();
    }
    this.fitCamera();
    this.loop.invalidate();
  }

  setHighlights(highlights: PreviewHighlights): void {
    this.highlights = highlights;
    this.applyHighlights();
    this.loop.invalidate();
  }

  setCallbacks(callbacks: MechPreviewCallbacks): void {
    this.callbacks = callbacks;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.destroy();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.host.ownerDocument.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.host.ownerDocument.defaultView?.removeEventListener('resize', this.resize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    if (this.current !== null) {
      this.turntable.remove(this.current.model.root);
      this.current.dispose();
      this.current = null;
    }
    this.raycastMarkers.length = 0;
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  private readonly draw = (deltaSeconds: number): void => {
    if (this.disposed) return;
    if (deltaSeconds > 0) {
      this.turntable.rotation.y = MathUtils.euclideanModulo(
        this.turntable.rotation.y + deltaSeconds * 0.34,
        Math.PI * 2,
      );
    }
    try {
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      this.reportFailure(error);
    }
  };

  private installObservers(): void {
    this.host.ownerDocument.addEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.host);
    } else this.host.ownerDocument.defaultView?.addEventListener('resize', this.resize);

    if (typeof IntersectionObserver === 'function') {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) this.loop.setIntersecting(entry.isIntersecting);
      });
      this.intersectionObserver.observe(this.host);
    }
  }

  private installPointerEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  private readonly onVisibilityChange = (): void => {
    this.loop.setDocumentVisible(this.host.ownerDocument.visibilityState !== 'hidden');
  };

  private readonly resize = (): void => {
    if (this.disposed) return;
    try {
      const width = Math.max(1, this.host.clientWidth);
      const height = Math.max(1, this.host.clientHeight);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.fitCamera();
      this.loop.invalidate();
    } catch (error) {
      this.reportFailure(error);
    }
  };

  private fitCamera(): void {
    const vertical = MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const halfFov = Math.max(0.15, Math.min(vertical, horizontal) / 2);
    const distance = (this.radius / Math.sin(halfFov)) * 1.12;
    this.camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
    this.camera.near = Math.max(0.1, distance - this.radius * 1.6);
    this.camera.far = distance + this.radius * 3;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.setPointerLocation(this.pick(event));
  };

  private readonly onPointerLeave = (): void => {
    this.setPointerLocation(null);
  };

  private readonly onClick = (event: MouseEvent): void => {
    const location = this.pick(event);
    this.setPointerLocation(location);
    if (location !== null) this.callbacks.onSelectLocation?.(location);
  };

  private pick(event: Pick<MouseEvent, 'clientX' | 'clientY'>): MechLocation | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.raycastMarkers, false, this.hits);
    const location = this.hits[0]?.object.userData.hardpointLocation;
    return typeof location === 'string' ? location as MechLocation : null;
  }

  private setPointerLocation(location: MechLocation | null): void {
    if (location === this.pointerLocation) return;
    this.pointerLocation = location;
    this.renderer.domElement.style.cursor = location === null ? '' : 'pointer';
    this.applyHighlights();
    this.loop.setInteractionPaused(location !== null);
    this.loop.invalidate();
    this.callbacks.onHoverLocation?.(location);
  }

  private applyHighlights(): void {
    if (this.current === null) return;
    setPreviewHighlights(this.current, {
      selected: this.highlights.selected,
      hovered: this.pointerLocation ?? this.highlights.hovered,
      compatible: this.highlights.compatible,
    });
  }

  private readonly onContextLost = (event: Event): void => {
    if (this.disposed) return;
    event.preventDefault();
    this.reportFailure(new Error('mech preview WebGL context lost'));
  };

  private reportFailure(error: unknown): void {
    const onFailure = this.callbacks.onFailure;
    this.destroy();
    if (onFailure === undefined) throw error;
    onFailure();
  }
}
