import { describe, expect, it } from 'vitest';
import { InstancedBufferAttribute, Matrix4, ShaderMaterial, Vector3 } from 'three';
import { ContactShadowLayer, contactShadowStrength } from './contactShadows';

describe('contact shadows', () => {
  it('keeps every visible unit in one fixed instanced layer', () => {
    const shadows = new ContactShadowLayer(() => 7, 2);
    shadows.begin();
    shadows.place({ x: 20, y: 30 }, 12, 0, 0);
    shadows.place({ x: 50, y: 60 }, 18, 1, 0);
    shadows.place({ x: 80, y: 90 }, 24, 2, 0);
    shadows.commit();

    expect(shadows.mesh.count).toBe(2);
    expect(shadows.mesh.instanceMatrix.count).toBe(2);
  });

  it('stays on the terrain and softens while its unit jumps', () => {
    const shadows = new ContactShadowLayer(() => 11, 2);
    shadows.begin();
    shadows.place({ x: 40, y: 70 }, 10, 0, 0);
    shadows.place({ x: 40, y: 70 }, 10, 0, 22);
    shadows.commit();

    const matrix = new Matrix4();
    const grounded = new Vector3();
    const airborne = new Vector3();
    shadows.mesh.getMatrixAt(0, matrix);
    grounded.setFromMatrixPosition(matrix);
    shadows.mesh.getMatrixAt(1, matrix);
    airborne.setFromMatrixPosition(matrix);

    const strength = shadows.mesh.geometry.getAttribute(
      'shadowStrength',
    ) as InstancedBufferAttribute;
    expect(airborne.y).toBeCloseTo(grounded.y, 6);
    expect(strength.getX(1)).toBeLessThan(strength.getX(0));
    expect(contactShadowStrength(22, 10)).toBeGreaterThan(0);
  });

  it('disposes its local geometry and shader', () => {
    const shadows = new ContactShadowLayer(() => 0);
    const geometry = shadows.mesh.geometry;
    const material = shadows.mesh.material as ShaderMaterial;
    let geometryDisposed = false;
    let materialDisposed = false;
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });

    shadows.dispose();
    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});
