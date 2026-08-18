import { Vector3 } from 'three';
import { radiusFor } from '../render/shape';
import { angleDifference } from '../sim/math';
import type { EntityId, MechEntity, Vec2 } from '../sim/types';
import type { BattleEffects } from './battleEffects';
import { createFootContactState, resetFootContact, settleFootContact,
  type FootContactState } from './footContact';
import { resetLegPose, writeJumpPose, writeStridePose, writeTurnPose, type LegPose } from './legMotion';
import type { MechModel } from './mechModel';
import { strideLengthFor, strideSwing, turnStrideLength } from './motionProfiles';
import {
  advanceGait,
  gaitForTerrain,
  responseBlend,
  type GaitProfile,
} from './terrainGait';
import type { Interpolated } from './unitViews';

export { advanceGait, gaitForTerrain, responseBlend, type GaitProfile } from './terrainGait';

export interface GroundSample {
  height: number;
  gradeX: number;
  gradeY: number;
}

interface AnimationState {
  phase: number;
  amp: number;
  lean: number;
  lastX: number;
  lastY: number;
  lastFacing: number;
  hasLast: boolean;
  lastStep: number;
  fall: number;
  ground: number;
  gradeX: number;
  gradeY: number;
  hasGround: boolean;
  gait: GaitProfile;
  landedFall: boolean;
  wasJumping: boolean;
  poses: [LegPose, LegPose];
  contact: FootContactState;
  turnPhase: number;
  turnDirection: -1 | 0 | 1;
}

const NOZZLE = new Vector3();
const TILT_LIMIT = 0.32;
const OPEN_KNEE = 0.5;

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

    const contact = entity.jump === null ? state.contact.body : 0;
    model.root.position.set(at.x, state.ground + lift + contact, at.y);
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

    const translated = state.hasLast ? Math.hypot(at.x - state.lastX, at.y - state.lastY) : 0;
    const turnDelta = state.hasLast ? angleDifference(state.lastFacing, at.facing) : 0;
    const turned = Math.abs(turnDelta);
    state.lastX = at.x;
    state.lastY = at.y;
    state.lastFacing = at.facing;
    state.hasLast = true;

    const motion = model.motion;
    if (model.legs.length === 0 || motion === null) {
      model.root.rotation.x = tilt.x;
      return;
    }

    advanceGait(state.gait, gaitForTerrain(terrainId), dt);
    const profile = state.gait;
    const grade = Math.hypot(state.gradeX, state.gradeY);
    const climb = clamp(grade / 0.45, 0, 1);
    const strideLength = strideLengthFor(model.legReach, motion, profile) * (1 - climb * 0.18);

    if (entity.jump !== null) {
      state.wasJumping = true;
      this.jumpPose(entity, model, state, tilt, dt);
      return;
    }

    if (state.wasJumping) {
      state.wasJumping = false;
      this.resetMotion(state, model, tilt);
      return;
    }

    if (translated > Math.max(2, model.strideLength * 2) || turned > Math.PI * 0.45) {
      this.resetMotion(state, model, tilt);
      return;
    }

    const turnTravel = turnDelta * model.turnRadius;
    const travelled = Math.hypot(translated, turnTravel);
    const pureTurn = turned > 0 && translated <= Math.abs(turnTravel) * 0.25;
    let posePhase: number;
    let poseStride = strideLength;
    if (pureTurn) {
      const direction: -1 | 1 = turnDelta < 0 ? -1 : 1;
      if (state.turnDirection !== direction) state.turnPhase = Math.PI / 2;
      state.turnDirection = direction;
      poseStride = turnStrideLength(strideLength, model.turnRadius);
      state.turnPhase += (Math.abs(turnTravel) / poseStride) * Math.PI;
      posePhase = state.turnPhase;
    } else if (translated > 0) {
      if (state.turnDirection !== 0) state.phase = Math.PI / 2;
      state.turnDirection = 0;
      state.phase += (travelled / strideLength) * Math.PI;
      posePhase = state.phase;
    } else {
      posePhase = state.turnDirection === 0 ? state.phase : state.turnPhase;
    }

    const speed = dt > 0 ? travelled / dt : 0;
    const wantedAmp = clamp(speed / 3.5, 0, 1);
    const acceleration = wantedAmp - state.amp;
    const wantedLean = -clamp(acceleration * 2.4, -1, 1) * motion.lean;
    state.amp += acceleration * responseBlend(motion.response, dt);
    state.lean += (wantedLean - state.lean) * responseBlend(motion.response * 0.72, dt);

    const swing = strideSwing(poseStride, model.legReach);
    const knee = motion.kneeLift * (profile.knee / OPEN_KNEE) * (1 + climb * 0.25) * state.amp;
    for (let index = 0; index < model.legs.length; index += 1) {
      const leg = model.legs[index];
      const pose = state.poses[index];
      if (leg === undefined || pose === undefined) continue;
      const phase = posePhase + (index === 0 ? 0 : Math.PI);
      if (state.turnDirection === 0) writeStridePose(pose, phase, swing, knee, 0);
      else writeTurnPose(pose, phase, swing, knee, index === 0 ? -1 : 1, state.turnDirection);
      leg.hip.rotation.z = pose.hip;
      leg.knee.rotation.z = pose.knee;
      leg.ankle.rotation.z = pose.ankle;
    }

    const bob = motion.bob * profile.bob * (1 - climb * 0.35);
    model.torso.position.y =
      model.torsoRestY + Math.abs(Math.sin(posePhase)) * model.torsoRestY * 0.035 * state.amp * bob;
    model.torso.rotation.x = Math.sin(posePhase) * 0.018 * state.amp * bob;
    model.torso.rotation.z = state.lean - Math.sin(posePhase) * motion.torsoCounter * state.amp;
    model.root.rotation.x = tilt.x;
    model.root.rotation.z = tilt.z;
    settleFootContact(
      state.contact,
      model,
      state.poses,
      this.heightAt,
      dt,
    );

    const step = Math.floor(posePhase / Math.PI);
    if (step !== state.lastStep) {
      state.lastStep = step;
      if (state.amp > 0.35 && travelled !== 0 && this.onFootfall !== null) {
        this.onFootfall({ x: at.x, y: at.y }, entity.tonnage);
      }
    }
  }

  private jumpPose(
    entity: MechEntity,
    model: MechModel,
    state: AnimationState,
    tilt: { x: number; z: number },
    dt: number,
  ): void {
    const jump = entity.jump;
    const motion = model.motion;
    if (jump === null || motion === null) return;
    const progress = jump.duration <= 0 ? 1 : jump.elapsed / jump.duration;
    state.amp += (0 - state.amp) * responseBlend(motion.response, dt);
    state.lean = 0;
    resetFootContact(state.contact, model);
    for (let index = 0; index < model.legs.length; index += 1) {
      const leg = model.legs[index];
      const pose = state.poses[index];
      if (leg === undefined || pose === undefined) continue;
      writeJumpPose(pose, progress, motion.tuck, index === 0 ? -1 : 1);
      leg.hip.rotation.z = pose.hip;
      leg.knee.rotation.z = pose.knee;
      leg.ankle.rotation.z = pose.ankle;
    }
    model.torso.position.y = model.torsoRestY;
    model.torso.rotation.x = 0;
    model.torso.rotation.z = 0;
    model.root.rotation.x = tilt.x;
    model.root.rotation.z = tilt.z;
  }

  private resetMotion(
    state: AnimationState,
    model: MechModel,
    tilt: { x: number; z: number },
  ): void {
    const previousContact = state.contact.body;
    state.phase = Math.PI / 2;
    state.turnPhase = Math.PI / 2;
    state.turnDirection = 0;
    state.amp = 0;
    state.lean = 0;
    state.lastStep = 0;
    resetFootContact(state.contact, model);
    model.root.position.y -= previousContact;
    for (let index = 0; index < model.legs.length; index += 1) {
      const leg = model.legs[index];
      const pose = state.poses[index];
      if (leg === undefined || pose === undefined) continue;
      resetLegPose(pose);
      leg.hip.rotation.z = 0;
      leg.knee.rotation.z = 0;
      leg.ankle.rotation.z = 0;
    }
    model.torso.position.y = model.torsoRestY;
    model.torso.rotation.x = 0;
    model.torso.rotation.z = 0;
    model.root.rotation.x = tilt.x;
    model.root.rotation.z = tilt.z;
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
      phase: Math.PI / 2,
      amp: 0,
      lean: 0,
      lastX: 0,
      lastY: 0,
      lastFacing: 0,
      hasLast: false,
      lastStep: 0,
      fall: 0,
      ground: 0,
      gradeX: 0,
      gradeY: 0,
      hasGround: false,
      gait: { ...gaitForTerrain('open') },
      landedFall: false,
      wasJumping: false,
      poses: [
        { hip: 0, knee: 0, ankle: 0, planted: true },
        { hip: 0, knee: 0, ankle: 0, planted: true },
      ],
      contact: createFootContactState(),
      turnPhase: Math.PI / 2,
      turnDirection: 0,
    };
    this.states.set(id, fresh);
    return fresh;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
