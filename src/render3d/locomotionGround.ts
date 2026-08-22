import type { Vec2 } from '../sim/types';

export interface GroundSample {
  height: number;
  gradeX: number;
  gradeY: number;
}

const TILT_LIMIT = 0.32;

/** Samples world axes so turning on one slope cannot exchange pitch and roll. */
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
    x: clamp(-Math.atan(left), -TILT_LIMIT, TILT_LIMIT),
    z: clamp(Math.atan(forward), -TILT_LIMIT, TILT_LIMIT),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
