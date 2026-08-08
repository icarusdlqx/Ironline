import type { Container } from 'pixi.js';
import type { Vec2 } from '../sim/types';

export interface Viewport {
  width: number;
  height: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  minZoom = 0.35;
  maxZoom = 4;

  private boundsWidth = 0;
  private boundsHeight = 0;

  setBounds(width: number, height: number): void {
    this.boundsWidth = width;
    this.boundsHeight = height;
  }

  centreOn(point: Vec2): void {
    this.x = point.x;
    this.y = point.y;
    this.clamp();
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  zoomAt(factor: number, screen: Vec2, viewport: Viewport): void {
    const before = this.screenToWorld(screen, viewport);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(screen, viewport);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  screenToWorld(screen: Vec2, viewport: Viewport): Vec2 {
    return {
      x: (screen.x - viewport.width / 2) / this.zoom + this.x,
      y: (screen.y - viewport.height / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(world: Vec2, viewport: Viewport): Vec2 {
    return {
      x: (world.x - this.x) * this.zoom + viewport.width / 2,
      y: (world.y - this.y) * this.zoom + viewport.height / 2,
    };
  }

  applyTo(container: Container, viewport: Viewport): void {
    container.scale.set(this.zoom);
    container.position.set(
      viewport.width / 2 - this.x * this.zoom,
      viewport.height / 2 - this.y * this.zoom,
    );
  }

  private clamp(): void {
    if (this.boundsWidth === 0 || this.boundsHeight === 0) return;
    this.x = Math.min(this.boundsWidth, Math.max(0, this.x));
    this.y = Math.min(this.boundsHeight, Math.max(0, this.y));
  }
}
