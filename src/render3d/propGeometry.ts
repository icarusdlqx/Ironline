import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropTheme } from '../schema/map';

export type PropKind =
  | 'tree'
  | 'snag'
  | 'boulder'
  | 'shale'
  | 'crag'
  | 'block'
  | 'causeway'
  | 'wreckage';

interface Part {
  geometry: BufferGeometry;
  colour: number;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

function prepare(part: Part): BufferGeometry {
  const geometry = part.geometry;
  const [sx, sy, sz] = part.scale ?? [1, 1, 1];
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
  const [x, y, z] = part.position ?? [0, 0, 0];
  geometry.scale(sx, sy, sz);
  geometry.rotateX(rx);
  geometry.rotateY(ry);
  geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  geometry.deleteAttribute('uv');

  const colour = new Color(part.colour);
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = colour.r;
    values[index * 3 + 1] = colour.g;
    values[index * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(values, 3));

  if (geometry.index === null) return geometry;
  const unindexed = geometry.toNonIndexed();
  geometry.dispose();
  return unindexed;
}

function merge(parts: readonly Part[]): BufferGeometry {
  const prepared = parts.map(prepare);
  const geometry = mergeGeometries(prepared, false);
  for (const part of prepared) part.dispose();
  if (geometry === null) throw new Error('prop geometry parts did not share attributes');
  geometry.computeBoundingSphere();
  return geometry;
}

function tree(theme: PropTheme): BufferGeometry {
  const foliage =
    theme === 'causeway' ? 0x385242 : theme === 'shale' ? 0x3f4d35 : 0x294a30;
  const bark = theme === 'shale' ? 0x51483a : 0x4a3a28;
  return merge([
    {
      geometry: new CylinderGeometry(0.18, 0.25, 1, 5),
      colour: bark,
      position: [0, 0.29, 0],
      scale: [1, 0.58, 1],
    },
    {
      geometry: new ConeGeometry(1, 1, 6),
      colour: foliage,
      position: [0, 0.52, 0],
      scale: [1, 0.56, 1],
    },
    {
      geometry: new ConeGeometry(0.72, 1, 6),
      colour: foliage,
      position: [0, 0.76, 0],
      scale: [1, 0.48, 1],
    },
  ]);
}

function snag(theme: PropTheme): BufferGeometry {
  const bark = theme === 'shale' ? 0x554a3b : 0x4f4131;
  return merge([
    {
      geometry: new CylinderGeometry(0.14, 0.24, 1, 5),
      colour: bark,
      position: [0, 0.5, 0],
    },
    {
      geometry: new CylinderGeometry(0.055, 0.08, 0.45, 5),
      colour: bark,
      position: [0.15, 0.65, 0],
      rotation: [0, 0, -0.82],
    },
    {
      geometry: new CylinderGeometry(0.045, 0.07, 0.36, 5),
      colour: bark,
      position: [-0.13, 0.79, 0.04],
      rotation: [0.18, 0, 0.92],
    },
  ]);
}

function boulder(): BufferGeometry {
  return merge([
    {
      geometry: new IcosahedronGeometry(1, 0),
      colour: 0x6a6154,
      position: [-0.18, 0.42, 0],
      rotation: [0.1, 0.35, 0],
      scale: [0.72, 0.48, 0.62],
    },
    {
      geometry: new IcosahedronGeometry(1, 0),
      colour: 0x59544b,
      position: [0.42, 0.25, 0.18],
      rotation: [0, 0.72, 0.16],
      scale: [0.38, 0.28, 0.42],
    },
    {
      geometry: new IcosahedronGeometry(1, 0),
      colour: 0x756b5b,
      position: [0.15, 0.18, -0.42],
      rotation: [0.2, 0.1, -0.08],
      scale: [0.3, 0.2, 0.34],
    },
  ]);
}

function shale(): BufferGeometry {
  return merge([
    {
      geometry: new ConeGeometry(0.48, 1, 4),
      colour: 0x57534d,
      position: [-0.22, 0.48, 0.02],
      rotation: [0.08, 0.28, -0.22],
      scale: [0.72, 0.96, 0.34],
    },
    {
      geometry: new ConeGeometry(0.42, 1, 4),
      colour: 0x45474a,
      position: [0.2, 0.37, 0.12],
      rotation: [-0.1, -0.38, 0.3],
      scale: [0.6, 0.74, 0.3],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x666057,
      position: [0.12, 0.12, -0.25],
      rotation: [0.14, 0.32, 0.08],
      scale: [0.55, 0.18, 0.3],
    },
  ]);
}

function block(theme: PropTheme): BufferGeometry {
  if (theme !== 'industrial') {
    return merge([
      {
        geometry: new BoxGeometry(1, 1, 1),
        colour: 0x6e6960,
        position: [0, 0.5, 0],
      },
    ]);
  }
  return merge([
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x625e57,
      position: [0, 0.38, 0],
      scale: [1, 0.76, 1],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x45494a,
      position: [-0.18, 0.84, 0.08],
      scale: [0.55, 0.18, 0.62],
    },
    {
      geometry: new CylinderGeometry(0.07, 0.09, 0.5, 6),
      colour: 0x4d443b,
      position: [0.27, 0.95, -0.22],
    },
  ]);
}

function causeway(): BufferGeometry {
  return merge([
    {
      geometry: new CylinderGeometry(0.035, 0.05, 1, 5),
      colour: 0x4b4e4e,
      position: [0, 0.5, 0],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x69655d,
      position: [0, 0.52, 0],
      scale: [1, 0.045, 0.035],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x69655d,
      position: [0, 0.3, 0],
      scale: [1, 0.04, 0.035],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x3f4446,
      position: [0, 0.92, 0],
      scale: [0.34, 0.055, 0.055],
    },
  ]);
}

function wreckage(): BufferGeometry {
  return merge([
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x403b36,
      position: [0, 0.3, 0],
      rotation: [0.05, 0.08, -0.07],
      scale: [0.8, 0.34, 0.54],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x292d2d,
      position: [-0.52, 0.2, 0],
      rotation: [0, 0.06, 0.08],
      scale: [0.22, 0.24, 0.76],
    },
    {
      geometry: new BoxGeometry(1, 1, 1),
      colour: 0x292d2d,
      position: [0.52, 0.18, 0.02],
      rotation: [0, -0.08, -0.05],
      scale: [0.22, 0.22, 0.76],
    },
    {
      geometry: new IcosahedronGeometry(1, 0),
      colour: 0x675746,
      position: [0.55, 0.13, -0.5],
      scale: [0.22, 0.14, 0.24],
    },
    {
      geometry: new IcosahedronGeometry(1, 0),
      colour: 0x554b42,
      position: [-0.42, 0.11, 0.52],
      scale: [0.25, 0.12, 0.18],
    },
  ]);
}

export function createPropGeometry(kind: PropKind, theme: PropTheme): BufferGeometry {
  switch (kind) {
    case 'tree': return tree(theme);
    case 'snag': return snag(theme);
    case 'boulder': return boulder();
    case 'shale': return shale();
    case 'crag':
      return merge([
        {
          geometry: new ConeGeometry(1, 1, 5),
          colour: 0x363a42,
          position: [0, 0.5, 0],
        },
      ]);
    case 'block': return block(theme);
    case 'causeway': return causeway();
    case 'wreckage': return wreckage();
  }
}
