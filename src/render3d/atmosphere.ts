import {
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
  HemisphereLight,
  Vector3,
  type Object3D,
} from 'three';
import type { Atmosphere, Direction } from '../schema/atmosphere';

const RADIANS = Math.PI / 180;

/**
 * Turns an authored angle into the offset a light stands at, relative to the
 * middle of the map. Elevation is measured up from the ground, azimuth round
 * from +x toward +z.
 */
function offsetFor(direction: Direction): Vector3 {
  const flat = direction.distance * Math.cos(direction.elevationDegrees * RADIANS);
  return new Vector3(
    flat * Math.cos(direction.azimuthDegrees * RADIANS),
    direction.distance * Math.sin(direction.elevationDegrees * RADIANS),
    flat * Math.sin(direction.azimuthDegrees * RADIANS),
  );
}

export interface AtmosphereRig {
  sun: DirectionalLight;
  fill: DirectionalLight;
  hemisphere: HemisphereLight;
  fog: Fog | FogExp2;
  sky: Color;
  exposure: number;
  /** Mixed into the baked terrain and prop colours; null when nothing to mix. */
  tint: { colour: Color; strength: number } | null;
}

/**
 * Builds the lights and air for one battlefield.
 *
 * The two directional lights are aimed at a target sitting in the middle of the
 * map rather than being left to point at the world origin: a directional light
 * shadows the box its own camera covers, and that camera follows its target, so
 * an unaimed sun lights one corner and draws a visible edge across the ground
 * where its coverage stops.
 */
export function buildAtmosphereRig(
  atmosphere: Atmosphere,
  target: Object3D,
  midpoint: Vector3,
  span: number,
): AtmosphereRig {
  const sun = new DirectionalLight(new Color(atmosphere.sun.colour), atmosphere.sun.intensity);
  sun.position.copy(midpoint).add(offsetFor(atmosphere.sun.direction));
  sun.target = target;

  // A moon at a tenth of daylight throws nothing worth a 2048² shadow pass, and
  // the pass costs the same whether the light is bright or not.
  sun.castShadow = atmosphere.sun.shadows;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 80;
    sun.shadow.camera.far = 2_600;
    sun.shadow.bias = -0.0016;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
  }

  const fill = new DirectionalLight(new Color(atmosphere.fill.colour), atmosphere.fill.intensity);
  fill.position.copy(midpoint).add(offsetFor(atmosphere.fill.direction));
  fill.target = target;

  const hemisphere = new HemisphereLight(
    new Color(atmosphere.hemisphere.sky),
    new Color(atmosphere.hemisphere.ground),
    atmosphere.hemisphere.intensity,
  );

  const fog =
    atmosphere.fog.kind === 'linear'
      ? new Fog(new Color(atmosphere.fog.colour), atmosphere.fog.near, atmosphere.fog.far)
      : new FogExp2(new Color(atmosphere.fog.colour), atmosphere.fog.density);

  return {
    sun,
    fill,
    hemisphere,
    fog,
    sky: new Color(atmosphere.sky),
    exposure: atmosphere.exposure,
    tint:
      atmosphere.terrainTint.strength === 0
        ? null
        : {
            colour: new Color(atmosphere.terrainTint.colour),
            strength: atmosphere.terrainTint.strength,
          },
  };
}

/** The colour the ground beyond the map edge is painted, so the horizon reads. */
export function surroundColour(rig: AtmosphereRig): Color {
  return rig.fog instanceof Fog || rig.fog instanceof FogExp2
    ? new Color(rig.fog.color)
    : new Color(rig.sky);
}
