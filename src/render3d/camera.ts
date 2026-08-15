import {
  Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Ray,
} from 'three';

import type { Vec2 } from '../sim/types';

export interface Viewport {
  width: number;
  height: number;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * The battlefield is flat in the simulation, so the world is laid out on the
 * XZ plane with Y as height: a simulation point (x, y) is (x, ground, y) here.
 * Nothing outside this module should have to remember that.
 */
export function toWorld(point: Vec2, height = 0): Vector3 {
  return new Vector3(point.x, height, point.y);
}

/**
 * A fixed tactical camera: it looks down at the battlefield from one bearing
 * and one tilt, and the player pans and zooms. Nothing rotates.
 *
 * That is a deliberate simplification. A camera that can be spun means every
 * control which turns a click into an order has to be right in a rotated
 * frame, and it means the player can lose which way is north mid-fight. The
 * bearing and tilt are still fields, so a mission or a cutscene can choose a
 * different fixed angle without any of this having to change.
 */
export class TacticalCamera {
  readonly camera = new PerspectiveCamera(45, 1, 1, 6_000);

  /** The ground point the camera is looking at. */
  target: Vec2 = { x: 0, y: 0 };
  distance = 470;
  /** Bearing the camera looks from. Fixed: looking down the map from the south. */
  readonly azimuth = -Math.PI / 2;
  /** Tilt above the horizon. High enough to read the ground, low enough for depth. */
  readonly elevation = 50 * DEGREES_TO_RADIANS;

  minDistance = 160;
  maxDistance = 1_100;

  /**
   * Impact shake, set by the renderer each frame and applied to the eye alone.
   * The target stays put, so orders given mid-explosion still land where the
   * player aimed them.
   */
  readonly shake = new Vector3();

  /** How much of the drop-in is left: 1 at the top of it, 0 once settled. */
  private intro = 0;
  private introSeconds = 1;


  private boundsWidth = 0;
  private boundsHeight = 0;
  private readonly raycaster = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);

  setBounds(width: number, height: number): void {
    this.boundsWidth = width;
    this.boundsHeight = height;
  }

  centreOn(point: Vec2): void {
    this.target = { x: point.x, y: point.y };
    this.clamp();
  }

  /**
   * Opens the mission from where the dropship left the lance and settles onto
   * them. It is two seconds of establishing shot, so anything the player does
   * to the camera cuts it dead rather than fighting it — nobody should have to
   * wait out a flourish to give an order.
   */
  beginDropIn(seconds = 2.2): void {
    this.intro = 1;
    this.introSeconds = Math.max(0.1, seconds);
  }

  skipDropIn(): void {
    this.intro = 0;
  }

  /** Runs the drop-in down. Called once a frame by the renderer. */
  advance(deltaSeconds: number): void {
    if (this.intro <= 0) return;
    this.intro = Math.max(0, this.intro - deltaSeconds / this.introSeconds);
  }

  /** Screen-space drag, converted to a pan across the ground the player sees. */
  panBy(dx: number, dy: number): void {
    this.skipDropIn();
    const forward = this.groundForward();
    const right = { x: -forward.y, y: forward.x };

    this.target = {
      x: this.target.x + right.x * dx + forward.x * dy,
      y: this.target.y + right.y * dx + forward.y * dy,
    };
    this.clamp();
  }

  zoomBy(factor: number): void {
    this.skipDropIn();
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance / factor));
    // Zooming out shows more ground, so the bounds have to be re-applied.
    this.clamp();
  }

  /** Where the camera sits, given its target, bearing and tilt. */
  private eye(): Vector3 {
    // Squared, so the descent is fast at the top and slow at the bottom: the
    // lance comes up to meet the camera rather than the camera falling on them.
    const settle = this.intro * this.intro;
    const distance = this.distance * (1 + 1.9 * settle);
    // Steeper on the way in, easing back to the working tilt — the view out of
    // a dropship rather than a camera sliding sideways.
    const elevation = this.elevation + (Math.PI / 2 - this.elevation) * 0.5 * settle;

    const horizontal = Math.cos(elevation) * distance;
    return new Vector3(
      this.target.x + Math.cos(this.azimuth) * horizontal,
      Math.sin(elevation) * distance,
      this.target.y + Math.sin(this.azimuth) * horizontal,
    );
  }

  /** The direction "up the screen" corresponds to on the ground. */
  private groundForward(): Vec2 {
    return { x: Math.cos(this.azimuth), y: Math.sin(this.azimuth) };
  }

  update(viewport: Viewport): void {
    this.camera.aspect = viewport.height === 0 ? 1 : viewport.width / viewport.height;
    this.camera.position.copy(this.eye()).add(this.shake);
    this.camera.lookAt(this.target.x, 0, this.target.y);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private ndc(screen: Vec2, viewport: Viewport): Vector2 {
    return new Vector2(
      (screen.x / viewport.width) * 2 - 1,
      1 - (screen.y / viewport.height) * 2,
    );
  }

  /**
   * The point on the battlefield under a screen position. Terrain is offered
   * first so clicking the top of a ridge means the ridge, not the flat ground
   * behind it; the ground plane catches everything else.
   */
  screenToWorld(screen: Vec2, viewport: Viewport, terrain: Object3D | null = null): Vec2 {
    this.update(viewport);
    this.raycaster.setFromCamera(this.ndc(screen, viewport), this.camera);

    if (terrain !== null) {
      const hit = this.raycaster.intersectObject(terrain, false)[0];
      if (hit !== undefined) return { x: hit.point.x, y: hit.point.z };
    }

    const point = new Vector3();
    if (this.raycaster.ray.intersectPlane(this.ground, point) === null) {
      // Looking at the sky. Fall back to the point the camera is aimed at
      // rather than handing back a NaN that would spread into an order.
      return { x: this.target.x, y: this.target.y };
    }
    return { x: point.x, y: point.z };
  }

  /**
   * The pick ray under a screen point, in world space. The ray is the
   * raycaster's own scratch — read it, don't keep it.
   */
  rayAt(screen: Vec2, viewport: Viewport): Ray {
    this.update(viewport);
    this.raycaster.setFromCamera(this.ndc(screen, viewport), this.camera);
    return this.raycaster.ray;
  }

  /** Where a battlefield point lands on screen, for HUD markers and marquees. */
  worldToScreen(point: Vec2, viewport: Viewport, height = 0): Vec2 {
    this.update(viewport);
    const projected = toWorld(point, height).project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * viewport.width,
      y: ((1 - projected.y) / 2) * viewport.height,
    };
  }

  /**
   * Roughly how much ground the camera can see across, given how far back it
   * is. Used to keep the battlefield on screen rather than the void beside it.
   */
  private visibleSpan(): number {
    const halfFov = (this.camera.fov / 2) * DEGREES_TO_RADIANS;
    return (2 * this.distance * Math.tan(halfFov)) / Math.max(0.2, Math.sin(this.elevation));
  }

  /**
   * Holds the view over the battlefield. Clamping the target to the map edge
   * is not enough on its own: standing on the corner still fills most of the
   * screen with the ground beyond the map. The target is pulled in by a share
   * of what the camera can see, so panning stops when the map does — while
   * still letting a zoomed-out camera sit at the middle of a map smaller than
   * its own view.
   */
  private clamp(): void {
    if (this.boundsWidth === 0 || this.boundsHeight === 0) return;

    const inset = this.visibleSpan() * 0.3;
    const limit = (value: number, size: number): number => {
      const margin = Math.min(inset, size / 2);
      return Math.min(size - margin, Math.max(margin, value));
    };

    this.target.x = limit(this.target.x, this.boundsWidth);
    this.target.y = limit(this.target.y, this.boundsHeight);
  }

}
