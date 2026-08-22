import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Material,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Texture,
  type Object3D,
  type WebGLRenderer,
} from 'three';

export interface RendererStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface RendererInfo {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

const disposedRoots = new WeakSet<Object3D>();

/** A stable copy: Three resets the live counters at the next render. */
export function rendererStats(info: RendererInfo): RendererStats {
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
  };
}

export function configureRenderer(
  renderer: WebGLRenderer,
  lowFx: boolean,
  devicePixelRatio: number,
): void {
  renderer.setPixelRatio(lowFx ? 1 : Math.min(1.5, devicePixelRatio));
  renderer.shadowMap.enabled = !lowFx;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
}

function materialTextures(material: Material, textures: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) textures.add(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (entry instanceof Texture) textures.add(entry);
    }
  }

  const uniforms = (material as Material & {
    uniforms?: Record<string, { value?: unknown }>;
  }).uniforms;
  if (uniforms === undefined) return;
  for (const uniform of Object.values(uniforms)) {
    const value = uniform.value;
    if (value instanceof Texture) textures.add(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (entry instanceof Texture) textures.add(entry);
    }
  }
}

/** Releases resources reachable from one layer, once even when meshes share them. */
export function disposeObjectResources(root: Object3D): void {
  if (disposedRoots.has(root)) return;
  disposedRoots.add(root);
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const shadows = new Set<{ dispose: () => void }>();

  root.traverse((node) => {
    const drawable = node as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
      shadow?: { dispose?: () => void };
    };
    if (drawable.geometry instanceof BufferGeometry) geometries.add(drawable.geometry);
    const owned = drawable.material;
    if (Array.isArray(owned)) owned.forEach((material) => materials.add(material));
    else if (owned instanceof Material) materials.add(owned);
    if (typeof drawable.shadow?.dispose === 'function') {
      shadows.add(drawable.shadow as { dispose: () => void });
    }
  });

  if (root instanceof Scene) {
    if (root.background instanceof Texture) textures.add(root.background);
    if (root.environment instanceof Texture) textures.add(root.environment);
  }
  materials.forEach((material) => materialTextures(material, textures));
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  shadows.forEach((shadow) => shadow.dispose());
}

export function disposeRenderer(
  renderer: Pick<WebGLRenderer, 'dispose' | 'forceContextLoss'>,
): void {
  renderer.dispose();
  renderer.forceContextLoss();
}
