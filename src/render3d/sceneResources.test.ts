import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Texture,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  configureRenderer,
  disposeObjectResources,
  disposeRenderer,
  rendererStats,
} from './sceneResources';

describe('renderer configuration and telemetry', () => {
  it('uses explicit colour output and the bounded shadow sampler', () => {
    const setPixelRatio = vi.fn();
    const renderer = {
      setPixelRatio,
      shadowMap: { enabled: false, type: 0 },
      outputColorSpace: '',
      toneMapping: 0,
    } as unknown as WebGLRenderer;

    configureRenderer(renderer, false, 2);

    expect(setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(renderer.shadowMap).toMatchObject({ enabled: true, type: PCFShadowMap });
    expect(renderer.outputColorSpace).toBe(SRGBColorSpace);
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);

    configureRenderer(renderer, true, 2);
    expect(setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it('copies the counters the performance overlay can compare between frames', () => {
    expect(rendererStats({
      render: { calls: 23, triangles: 42_000 },
      memory: { geometries: 71, textures: 3 },
    })).toEqual({ calls: 23, triangles: 42_000, geometries: 71, textures: 3 });
  });
});

describe('scene resource lifetime', () => {
  it('disposes shared resources and atmosphere shadows once', () => {
    const scene = new Scene();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const shadow = { dispose: vi.fn() };
    const light = new Object3D() as Object3D & { shadow: typeof shadow };
    light.shadow = shadow;
    scene.background = texture;
    scene.add(new Mesh(geometry, material), new Mesh(geometry, material), light);

    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    const textureDisposed = vi.fn();
    geometry.addEventListener('dispose', geometryDisposed);
    material.addEventListener('dispose', materialDisposed);
    texture.addEventListener('dispose', textureDisposed);

    disposeObjectResources(scene);
    disposeObjectResources(scene);

    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(textureDisposed).toHaveBeenCalledTimes(1);
    expect(shadow.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases the renderer and its context once requested', () => {
    const renderer = { dispose: vi.fn(), forceContextLoss: vi.fn() };
    disposeRenderer(renderer as unknown as WebGLRenderer);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  });
});
