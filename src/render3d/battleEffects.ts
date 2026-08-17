import { Color, PointLight, Scene, Vector3 } from 'three';
import type { SimEvent } from '../sim/events';
import type { EntityId, Vec2, World } from '../sim/types';
import type { TacticalCamera } from './camera';
import { JetLayer, ScarLayer, SmokeLayer } from './effects';
import { TracerLayer } from './tracers';

interface MuzzleFlash {
  light: PointLight;
  ttl: number;
}

/** Combat effects and camera recoil share one clock and one fixed budget. */
export class BattleEffects {
  private readonly tracers = new TracerLayer();
  private readonly jets = new JetLayer();
  private readonly smoke: SmokeLayer;
  private readonly scars = new ScarLayer();
  private readonly flashes: MuzzleFlash[] = [];
  private shakeAmplitude = 0;
  private shakeTime = 0;
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    fogColour: Color,
    private readonly camera: TacticalCamera,
    private readonly heightAt: (x: number, y: number) => number,
    private readonly positionOf: (id: EntityId) => Vec2 | null,
  ) {
    this.smoke = new SmokeLayer(fogColour);
    scene.add(this.tracers.group, this.jets.group, this.smoke.mesh, this.scars.mesh);
  }

  beginFrame(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.jets.begin();
  }

  finishFrame(deltaSeconds: number): void {
    this.shakeTime += deltaSeconds;
    this.shakeAmplitude *= Math.exp(-deltaSeconds * 7);
    if (this.shakeAmplitude < 0.02) this.shakeAmplitude = 0;
    const t = this.shakeTime;
    this.camera.shake.set(
      Math.sin(t * 61) * this.shakeAmplitude,
      Math.sin(t * 47 + 1.3) * this.shakeAmplitude * 0.6,
      Math.cos(t * 53 + 0.7) * this.shakeAmplitude,
    );

    for (const flash of this.flashes) {
      if (flash.ttl <= 0) continue;
      flash.ttl -= deltaSeconds;
      if (flash.ttl <= 0) flash.light.visible = false;
      else flash.light.intensity *= 0.72;
    }

    this.jets.commit();
    this.tracers.update(deltaSeconds);
    this.smoke.update(deltaSeconds);
  }

  consume(world: World, events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'mech_destroyed' || event.type === 'ammo_explosion') {
        const at = this.positionOf(event.entityId);
        if (at !== null) this.addShake(6 * this.nearness(at));
        if (at !== null && event.type === 'mech_destroyed') {
          this.smoke.start(at, this.heightAt(at.x, at.y));
          this.scars.mark(at, this.heightAt(at.x, at.y), 22, 0.55);
        }
      } else if (event.type === 'projectile_hit' && event.damage >= 14) {
        const at = this.positionOf(event.targetId);
        if (at !== null) this.addShake(1.6 * this.nearness(at));
      } else if (event.type === 'jump_landed') {
        this.addShake(1.4 * this.nearness({ x: event.x, y: event.y }));
      }

      if (event.type !== 'weapon_fired' && event.type !== 'projectile_hit') continue;

      const weapon = world.catalog.weapons.get(event.weaponId);
      const colour = weapon === undefined ? 0xffffff : parseInt(weapon.visual.colour.slice(1), 16);

      if (event.type === 'projectile_hit') {
        const at = this.positionOf(event.targetId);
        if (at !== null) {
          this.tracers.impact(at, this.heightAt(at.x, at.y), colour);
          const damage = weapon?.damage ?? 5;
          this.scars.mark(
            { x: at.x + (event.tick % 7) - 3, y: at.y + (event.tick % 5) - 2 },
            this.heightAt(at.x, at.y),
            3 + Math.min(9, damage * 0.35),
            weapon?.type === 'energy' ? 1 : 0.25,
          );
        }
        continue;
      }

      const shooter = this.positionOf(event.shooterId);
      const target = this.positionOf(event.targetId);
      if (shooter === null || target === null) continue;

      this.tracers.fire(
        shooter,
        target,
        weapon?.type ?? 'energy',
        weapon?.projectiles ?? 1,
        colour,
        this.heightAt,
      );
      this.muzzleLight(shooter, colour, weapon?.damage ?? 5);
    }
  }

  land(at: Vec2, colour: number, shake: number): void {
    this.tracers.impact(at, this.heightAt(at.x, at.y) + 2, colour);
    this.addShake(shake * this.nearness(at));
  }

  plume(key: number, at: Vector3, throttle: number): void {
    this.jets.plume(key, at, throttle, this.elapsed);
  }

  spawnSmoke(at: Vec2): void {
    this.tracers.spawnSmoke(at, this.heightAt(at.x, at.y));
  }

  private nearness(at: Vec2): number {
    const distance = Math.hypot(at.x - this.camera.target.x, at.y - this.camera.target.y);
    return Math.max(0, 1 - distance / 700);
  }

  private addShake(magnitude: number): void {
    this.shakeAmplitude = Math.min(9, this.shakeAmplitude + magnitude);
  }

  private muzzleLight(at: Vec2, colour: number, damage: number): void {
    const idle = this.flashes.find((flash) => flash.ttl <= 0);
    const flash = idle ?? this.newFlash();
    if (flash === null) return;
    flash.ttl = 0.09;
    flash.light.color.setHex(colour);
    flash.light.intensity = 300 + damage * 40;
    flash.light.position.set(at.x, this.heightAt(at.x, at.y) + 16, at.y);
    flash.light.visible = true;
  }

  private newFlash(): MuzzleFlash | null {
    if (this.flashes.length >= 4) return null;
    const light = new PointLight(0xffffff, 0, 120, 2);
    light.visible = false;
    this.scene.add(light);
    const flash = { light, ttl: 0 };
    this.flashes.push(flash);
    return flash;
  }
}
