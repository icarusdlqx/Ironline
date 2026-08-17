import { Vector3 } from 'three';
import { radiusFor } from '../render/shape';
import type { EntityId, MechEntity, Vec2 } from '../sim/types';
import type { BattleEffects } from './battleEffects';
import type { MechModel } from './mechModel';
import type { Interpolated } from './unitViews';

export interface GroundSample {
  height: number;
  gradeX: number;
  gradeY: number;
}

export interface GaitProfile {
  stride: number;
  swing: number;
  knee: number;
  bob: number;
}

interface AnimationState {
  phase: number;
  amp: number;
  lastX: number;
  lastY: number;
  hasLast: boolean;
  lastStep: number;
  fall: number;
  ground: number;
  gradeX: number;
  gradeY: number;
  hasGround: boolean;
  gait: GaitProfile;
  landedFall: boolean;
}

const NOZZLE = new Vector3();
const TILT_LIMIT = 0.32;

const GAITS: Record<string, GaitProfile> = {
  open: { stride: 1, swing: 0.42, knee: 0.5, bob: 1 },
  road: { stride: 1.08, swing: 0.43, knee: 0.46, bob: 0.9 },
  forest: { stride: 0.74, swing: 0.32, knee: 0.68, bob: 0.68 },
  rough: { stride: 0.84, swing: 0.36, knee: 0.6, bob: 0.78 },
  water: { stride: 0.7, swing: 0.28, knee: 0.72, bob: 0.52 },
  building: { stride: 0.9, swing: 0.37, knee: 0.55, bob: 0.82 },
};

export function gaitForTerrain(terrainId: string): GaitProfile {
  return GAITS[terrainId] ?? GAITS.open ?? { stride: 1, swing: 0.42, knee: 0.5, bob: 1 };
}

/** Samples gradients in world axes, so a turn on one slope cannot swap lagging pitch and roll. */
export function sampleGround(
  heightAt: (x: number, y: number) => number,
  at: Vec2,
  reach: number,
): GroundSample {
  const span = Math.max(1, reach);
  const centre = heightAt(at.x, at.y);
  const east = heightAt(at.x + span, at.y);
  const west = heightAt(at.x - span, at.y);
  const south = heightAt(at.x, at.y + span);
  const north = heightAt(at.x, at.y - span);
  return {
    height: centre,
    gradeX: (east - west) / (span * 2),
    gradeY: (south - north) / (span * 2),
  };
}

export function localTilt(
  gradeX: number,
  gradeY: number,
  facing: number,
): { x: number; z: number } {
  const forward = gradeX * Math.cos(facing) + gradeY * Math.sin(facing);
  const left = -gradeX * Math.sin(facing) + gradeY * Math.cos(facing);
  return {
    // The hull faces local +X: forward pitch is around Z, lateral roll around X.
    x: clamp(-Math.atan(left), -TILT_LIMIT, TILT_LIMIT),
    z: clamp(Math.atan(forward), -TILT_LIMIT, TILT_LIMIT),
  };
}

export function responseBlend(rate: number, deltaSeconds: number): number {
  return 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
}

export function advanceGait(
  current: GaitProfile,
  target: GaitProfile,
  deltaSeconds: number,
): void {
  const blend = responseBlend(7, deltaSeconds);
  current.stride += (target.stride - current.stride) * blend;
  current.swing += (target.swing - current.swing) * blend;
  current.knee += (target.knee - current.knee) * blend;
  current.bob += (target.bob - current.bob) * blend;
}

/** Render-only gait and ground pose; simulation positions remain authoritative. */
export class Locomotion {
  onFootfall: ((at: Vec2, tonnage: number) => void) | null = null;

  private readonly states = new Map<EntityId, AnimationState>();

  constructor(
    private readonly heightAt: (x: number, y: number) => number,
    private readonly terrainAt: (at: Vec2) => string,
    private readonly effects: BattleEffects,
  ) {}

  place(
    entity: MechEntity,
    model: MechModel,
    at: Interpolated,
    lift: number,
    deltaSeconds: number,
  ): void {
    const state = this.stateFor(entity.id);
    const footprint = clamp(radiusFor(entity.tonnage) * 0.78, 8, 20);
    const ground = sampleGround(this.heightAt, at, footprint);
    this.followGround(state, ground, deltaSeconds);
    const tilt = localTilt(state.gradeX, state.gradeY, at.facing);

    model.root.position.set(at.x, state.ground + lift, at.y);
    model.root.rotation.y = -at.facing;
    model.root.rotation.x = tilt.x;
    model.root.rotation.z = tilt.z;
    model.torso.rotation.y = -at.torso;

    this.animate(entity, model, at, deltaSeconds, tilt, this.terrainAt(at));
    if (entity.jump !== null) this.burn(entity, model);
  }

  private followGround(state: AnimationState, target: GroundSample, dt: number): void {
    if (!state.hasGround) {
      state.ground = target.height;
      state.gradeX = target.gradeX;
      state.gradeY = target.gradeY;
      state.hasGround = true;
      return;
    }
    const slopeBlend = responseBlend(9, dt);
    state.ground = target.height;
    state.gradeX += (target.gradeX - state.gradeX) * slopeBlend;
    state.gradeY += (target.gradeY - state.gradeY) * slopeBlend;
  }

  private animate(
    entity: MechEntity,
    model: MechModel,
    at: Interpolated,
    dt: number,
    tilt: { x: number; z: number },
    terrainId: string,
  ): void {
    const state = this.stateFor(entity.id);

    if (entity.destroyed) {
      state.fall = Math.min(1, state.fall + dt * 1.5);
      const eased = 1 - (1 - state.fall) ** 2;
      const direction = entity.id % 2 === 0 ? 1 : -1;
      model.root.rotation.z = -eased * 1.22 * direction;
      model.root.position.y -= eased * 1.2;
      if (state.fall >= 1 && !state.landedFall) {
        state.landedFall = true;
        this.effects.land({ x: at.x, y: at.y }, 0x8a8a82, 2.5);
      }
      return;
    }

    const down = entity.downRemaining > 0;
    state.fall = clamp(state.fall + dt * (down ? 2.2 : -1.8), 0, 1);
    if (state.fall > 0) {
      const eased = 1 - (1 - state.fall) ** 2;
      const direction = entity.id % 2 === 0 ? 1 : -1;
      model.root.rotation.z = -eased * 1.1 * direction;
      model.root.position.y -= eased * 1.05;
      if (down && state.fall >= 1 && !state.landedFall) {
        state.landedFall = true;
        this.effects.land({ x: at.x, y: at.y }, 0x8a8a82, 1.8);
      }
      if (!down) state.landedFall = false;
      if (down) return;
    } else {
      model.root.rotation.z = tilt.z;
    }

    const travelled = state.hasLast ? Math.hypot(at.x - state.lastX, at.y - state.lastY) : 0;
    const moved = travelled > model.strideLength * 2 ? 0 : travelled;
    state.lastX = at.x;
    state.lastY = at.y;
    state.hasLast = true;

    if (model.legs.length === 0) {
      model.root.rotation.x = tilt.x;
      return;
    }

    advanceGait(state.gait, gaitForTerrain(terrainId), dt);
    const profile = state.gait;
    const grade = Math.hypot(state.gradeX, state.gradeY);
    const climb = clamp(grade / 0.45, 0, 1);
    const stride = profile.stride * (1 - climb * 0.18);
    state.phase += (moved / Math.max(1, model.strideLength * stride)) * Math.PI;

    const speed = dt > 0 ? moved / dt : 0;
    const wantedAmp = clamp(speed / 3.5, 0, 1);
    state.amp += (wantedAmp - state.amp) * responseBlend(8, dt);

    const swing = profile.swing * (1 - climb * 0.15) * state.amp;
    const knee = profile.knee * (1 + climb * 0.25) * state.amp;
    model.legs.forEach((leg, index) => {
      const phase = state.phase + (index === 0 ? 0 : Math.PI);
      leg.hip.rotation.z = Math.sin(phase) * swing;
      leg.knee.rotation.z = -Math.max(0, Math.sin(phase + 0.9)) * knee;
    });

    const bob = profile.bob * (1 - climb * 0.35);
    model.torso.position.y =
      model.torsoRestY + Math.abs(Math.sin(state.phase)) * model.torsoRestY * 0.035 * state.amp * bob;
    model.root.rotation.x = tilt.x + Math.sin(state.phase) * 0.02 * state.amp * bob;

    const step = Math.floor(state.phase / Math.PI);
    if (step !== state.lastStep) {
      state.lastStep = step;
      if (state.amp > 0.35 && this.onFootfall !== null) {
        this.onFootfall({ x: at.x, y: at.y }, entity.tonnage);
      }
    }
  }

  private burn(entity: MechEntity, model: MechModel): void {
    const jump = entity.jump;
    if (jump === null) return;
    const progress = jump.duration <= 0 ? 1 : jump.elapsed / jump.duration;
    const throttle = clamp(
      Math.max(0, 1 - progress * 2.4) + Math.max(0, (progress - 0.7) / 0.3) * 0.8,
      0,
      1,
    );
    if (throttle <= 0.02) return;

    model.legs.forEach((rig, leg) => {
      rig.knee.getWorldPosition(NOZZLE);
      this.effects.plume(entity.id * 2 + leg, NOZZLE, throttle);
    });
  }

  private stateFor(id: EntityId): AnimationState {
    const existing = this.states.get(id);
    if (existing !== undefined) return existing;
    const fresh: AnimationState = {
      phase: 0,
      amp: 0,
      lastX: 0,
      lastY: 0,
      hasLast: false,
      lastStep: 0,
      fall: 0,
      ground: 0,
      gradeX: 0,
      gradeY: 0,
      hasGround: false,
      gait: { ...gaitForTerrain('open') },
      landedFall: false,
    };
    this.states.set(id, fresh);
    return fresh;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
