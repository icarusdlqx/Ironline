import type { MechLocation } from '../schema/common';
import type { Vec2 } from '../sim/types';
import {
  clampReadout,
  readoutBounds,
  readoutEnvelope,
  type ReadoutEnvelope,
  type ReadoutLayout,
} from './readoutSafeArea';

export interface DamageCue {
  tick: number;
  targetId: number;
  location: MechLocation | null;
  screen: Vec2;
  armour?: number;
  structure?: number;
  misses?: number;
  critical?: string | null;
  locationLost?: boolean;
  ammo?: number;
  destroyed?: boolean;
}

interface ReadoutSlot {
  element: HTMLElement;
  active: boolean;
  age: number;
  tick: number;
  targetId: number;
  location: MechLocation | null;
  armour: number;
  structure: number;
  misses: number;
  criticalCount: number;
  criticals: Set<string>;
  locationLost: boolean;
  ammo: number;
  destroyed: boolean;
  label: string;
  anchor: Vec2;
  screen: Vec2;
  envelope: ReadoutEnvelope;
}

type ReadoutDocument = Pick<Document, 'createElement'>;

const LIFE_SECONDS = 1.35;
const DEFAULT_CAPACITY = 40;
const MAX_CAPACITY = 47;

function amount(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function append(label: string, cue: string): string {
  return label === '' ? cue : `${label} · ${cue}`;
}

function locationName(location: MechLocation | null): string {
  return location === null ? '' : location.replace(/_/g, ' ').toUpperCase();
}

/** A fixed DOM budget keeps a long firefight from growing a second HUD tree. */
export class DamageReadoutPool {
  private readonly root: HTMLElement;
  private readonly slots: ReadoutSlot[] = [];
  private layout: ReadoutLayout | null = null;
  private next = 0;

  constructor(
    host: HTMLElement,
    private readonly reducedMotion: boolean,
    capacity = DEFAULT_CAPACITY,
    dom: ReadoutDocument = document,
    private readonly layoutOf: (() => ReadoutLayout) | null = null,
  ) {
    const count = Math.max(1, Math.min(MAX_CAPACITY, Math.trunc(capacity)));
    this.root = dom.createElement('div');
    this.root.className = `damage-readouts${reducedMotion ? ' reduced-motion' : ''}`;
    this.root.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < count; index += 1) {
      const element = dom.createElement('span');
      element.className = 'damage-readout';
      element.hidden = true;
      this.root.appendChild(element);
      this.slots.push({
        element,
        active: false,
        age: 0,
        tick: -1,
        targetId: -1,
        location: null,
        armour: 0,
        structure: 0,
        misses: 0,
        criticalCount: 0,
        criticals: new Set<string>(),
        locationLost: false,
        ammo: 0,
        destroyed: false,
        label: '',
        anchor: { x: 0, y: 0 },
        screen: { x: 0, y: 0 },
        envelope: { halfWidth: 0, above: 0, below: 0 },
      });
    }
    host.appendChild(this.root);
  }

  get nodeCount(): number {
    return this.slots.length + 1;
  }

  get activeCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count += 1;
    return count;
  }

  refreshLayout(): void {
    this.layout = this.layoutOf?.() ?? null;
    if (this.layout !== null) this.reflow();
  }

  offer(cue: DamageCue): void {
    let slot = this.slots.find(
      (candidate) =>
        candidate.active &&
        candidate.tick === cue.tick &&
        candidate.targetId === cue.targetId &&
        candidate.location === cue.location,
    );
    if (slot === undefined) {
      slot = this.slots[this.next];
      this.next = (this.next + 1) % this.slots.length;
      if (slot === undefined) return;
      this.reset(slot, cue);
    }

    slot.armour += cue.armour ?? 0;
    slot.structure += cue.structure ?? 0;
    slot.misses += cue.misses ?? 0;
    if (cue.critical !== undefined) {
      slot.criticalCount += 1;
      if (cue.critical !== null && cue.critical !== '') slot.criticals.add(cue.critical);
    }
    slot.locationLost ||= cue.locationLost === true;
    slot.ammo += cue.ammo ?? 0;
    slot.destroyed ||= cue.destroyed === true;
    slot.age = 0;
    slot.anchor.x = cue.screen.x;
    slot.anchor.y = cue.screen.y;
    const label = this.labelFor(slot);
    slot.label = label;
    this.place(slot);
    this.paint(slot, label);
  }

  advance(deltaSeconds: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      if (slot.age < LIFE_SECONDS) continue;
      slot.active = false;
      slot.label = '';
      slot.envelope = { halfWidth: 0, above: 0, below: 0 };
      slot.element.hidden = true;
      slot.element.className = 'damage-readout';
    }
  }

  destroy(): void {
    for (const slot of this.slots) slot.active = false;
    this.root.remove();
  }

  private reset(slot: ReadoutSlot, cue: DamageCue): void {
    slot.active = true;
    slot.tick = cue.tick;
    slot.targetId = cue.targetId;
    slot.location = cue.location;
    slot.armour = 0;
    slot.structure = 0;
    slot.misses = 0;
    slot.criticalCount = 0;
    slot.criticals.clear();
    slot.locationLost = false;
    slot.ammo = 0;
    slot.destroyed = false;
  }

  private place(slot: ReadoutSlot): void {
    const layout = this.layout;
    if (layout === null) {
      slot.screen.x = slot.anchor.x;
      slot.screen.y = slot.anchor.y;
      slot.envelope = { halfWidth: 0, above: 0, below: 0 };
    } else {
      const occupied = this.slots
        .filter((candidate) => candidate !== slot && candidate.active && candidate.label !== '')
        .map((candidate) => readoutBounds(candidate.screen, candidate.envelope));
      const screen = clampReadout(
        slot.anchor,
        slot.label,
        layout,
        this.reducedMotion,
        occupied,
      );
      slot.screen.x = screen.x;
      slot.screen.y = screen.y;
      slot.envelope = readoutEnvelope(slot.label, layout.width, this.reducedMotion);
    }
    slot.element.style.left = `${String(slot.screen.x)}px`;
    slot.element.style.top = `${String(slot.screen.y)}px`;
  }

  private reflow(): void {
    const layout = this.layout;
    if (layout === null) return;
    const occupied = [];
    for (const slot of this.slots) {
      if (!slot.active || slot.label === '') continue;
      const screen = clampReadout(
        slot.anchor,
        slot.label,
        layout,
        this.reducedMotion,
        occupied,
      );
      slot.screen.x = screen.x;
      slot.screen.y = screen.y;
      slot.envelope = readoutEnvelope(slot.label, layout.width, this.reducedMotion);
      occupied.push(readoutBounds(slot.screen, slot.envelope));
      slot.element.style.left = `${String(slot.screen.x)}px`;
      slot.element.style.top = `${String(slot.screen.y)}px`;
    }
  }

  private labelFor(slot: ReadoutSlot): string {
    let label = '';
    if (slot.armour > 0) label = append(label, `-${amount(slot.armour)} ARMOUR`);
    if (slot.structure > 0) label = append(label, `-${amount(slot.structure)} STRUCTURE`);
    if (slot.misses > 0) {
      label = append(label, slot.misses === 1 ? 'MISS' : `MISS x${String(slot.misses)}`);
    }
    if (slot.criticalCount > 0) {
      const count = slot.criticalCount === 1 ? '' : ` x${String(slot.criticalCount)}`;
      let components = '';
      for (const name of slot.criticals) {
        const component = name.toUpperCase();
        components = components === '' ? component : `${components} / ${component}`;
      }
      label = append(label, `CRITICAL${count}${components === '' ? '' : `: ${components}`}`);
    }
    if (slot.locationLost) label = append(label, `LOCATION LOST: ${locationName(slot.location)}`);
    if (slot.ammo > 0) label = append(label, `AMMO ${amount(slot.ammo)}`);
    if (slot.destroyed) label = append(label, 'DESTROYED');
    return label;
  }

  private paint(slot: ReadoutSlot, label: string): void {
    const tone = slot.destroyed || slot.ammo > 0 || slot.locationLost
      ? 'danger'
      : slot.structure > 0 || slot.criticalCount > 0
        ? 'structure'
        : slot.misses > 0
          ? 'miss'
          : 'armour';
    slot.element.textContent = label;
    slot.element.hidden = false;
    slot.element.className = `damage-readout ${tone}`;
    void slot.element.offsetWidth;
    slot.element.className += ' is-active';
  }
}
