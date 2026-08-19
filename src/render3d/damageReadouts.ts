import type { MechLocation } from '../schema/common';
import type { Vec2 } from '../sim/types';
import {
  DEFAULT_READOUT_CAPACITY,
  MAX_READOUT_CAPACITY,
  READOUT_BURST_TICKS,
  READOUT_PRIORITY,
  compactReadouts,
  readoutBudget,
  readoutLabel,
  readoutLife,
  readoutPriority,
  readoutTone,
  type ReadoutCueFacts,
} from './damageReadoutPolicy';
import {
  clampReadout,
  readoutBounds,
  readoutEnvelope,
  type ReadoutEnvelope,
  type ReadoutLayout,
} from './readoutSafeArea';

export interface DamageCue extends ReadoutCueFacts {
  tick: number;
  targetId: number;
  screen: Vec2;
}

interface ReadoutSlot {
  element: HTMLElement;
  active: boolean;
  age: number;
  burstTick: number;
  targetId: number;
  armour: number;
  structure: number;
  misses: number;
  criticalCount: number;
  criticals: Set<string>;
  lostLocations: Set<MechLocation>;
  ammo: number;
  destroyed: boolean;
  priority: number;
  label: string;
  anchor: Vec2;
  screen: Vec2;
  envelope: ReadoutEnvelope;
}

type ReadoutDocument = Pick<Document, 'createElement'>;

/** A fixed DOM budget keeps a long firefight from growing a second HUD tree. */
export class DamageReadoutPool {
  private readonly root: HTMLElement;
  private readonly slots: ReadoutSlot[] = [];
  private layout: ReadoutLayout | null = null;
  private next = 0;

  constructor(
    host: HTMLElement,
    private readonly reducedMotion: boolean,
    capacity = DEFAULT_READOUT_CAPACITY,
    dom: ReadoutDocument = document,
    private readonly layoutOf: (() => ReadoutLayout) | null = null,
  ) {
    const count = Math.max(1, Math.min(MAX_READOUT_CAPACITY, Math.trunc(capacity)));
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
        burstTick: -1,
        targetId: -1,
        armour: 0,
        structure: 0,
        misses: 0,
        criticalCount: 0,
        criticals: new Set<string>(),
        lostLocations: new Set<MechLocation>(),
        ammo: 0,
        destroyed: false,
        priority: READOUT_PRIORITY.miss,
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
    for (const slot of this.slots) {
      if (slot.active && slot.label !== '') count += 1;
    }
    return count;
  }

  refreshLayout(): void {
    this.layout = this.layoutOf?.() ?? null;
    this.enforceBudget();
    if (this.layout !== null) this.reflow();
  }

  offer(cue: DamageCue): void {
    const incomingPriority = readoutPriority(cue);
    let slot = this.slots.find(
      (candidate) => candidate.active && candidate.targetId === cue.targetId,
    );
    const occupiedPreviously = slot !== undefined && slot.label !== '';
    let restart = false;
    if (slot !== undefined && cue.tick - slot.burstTick > READOUT_BURST_TICKS) {
      if (incomingPriority < slot.priority) return;
      this.reset(slot, cue, incomingPriority);
      restart = true;
    }
    if (slot === undefined) {
      slot = this.claim(incomingPriority);
      if (slot === undefined) return;
      this.reset(slot, cue, incomingPriority);
      restart = true;
    } else if (incomingPriority > slot.priority) {
      slot.priority = incomingPriority;
      slot.age = 0;
      restart = true;
    }

    slot.armour += cue.armour ?? 0;
    slot.structure += cue.structure ?? 0;
    slot.misses += cue.misses ?? 0;
    if (cue.critical !== undefined) {
      slot.criticalCount += 1;
      if (cue.critical !== null && cue.critical !== '') slot.criticals.add(cue.critical);
    }
    if (cue.locationLost === true && cue.location !== null) {
      slot.lostLocations.add(cue.location);
    }
    slot.ammo += cue.ammo ?? 0;
    slot.destroyed ||= cue.destroyed === true;
    slot.priority = Math.max(slot.priority, incomingPriority);
    slot.anchor.x = cue.screen.x;
    slot.anchor.y = cue.screen.y;
    const label = this.labelFor(slot);
    slot.label = label;
    if (label === '') {
      this.conceal(slot);
      return;
    }
    if (!occupiedPreviously && !this.admit(slot)) {
      this.conceal(slot);
      return;
    }
    if (!occupiedPreviously) slot.age = 0;
    this.paint(slot, label, restart || !occupiedPreviously);
    if (this.layout === null) this.place(slot);
    else this.reflow();
  }

  advance(deltaSeconds: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      if (slot.age < this.lifeFor(slot)) continue;
      this.deactivate(slot);
    }
  }

  destroy(): void {
    for (const slot of this.slots) slot.active = false;
    this.root.remove();
  }

  private reset(slot: ReadoutSlot, cue: DamageCue, priority: number): void {
    slot.active = true;
    slot.age = 0;
    slot.burstTick = cue.tick;
    slot.targetId = cue.targetId;
    slot.armour = 0;
    slot.structure = 0;
    slot.misses = 0;
    slot.criticalCount = 0;
    slot.criticals.clear();
    slot.lostLocations.clear();
    slot.ammo = 0;
    slot.destroyed = false;
    slot.priority = priority;
    slot.label = '';
  }

  private claim(priority: number): ReadoutSlot | undefined {
    for (let offset = 0; offset < this.slots.length; offset += 1) {
      const index = (this.next + offset) % this.slots.length;
      const slot = this.slots[index];
      if (slot?.active === false) {
        this.next = (index + 1) % this.slots.length;
        return slot;
      }
    }
    const victim = this.victimFor(priority, false);
    if (victim === undefined) return undefined;
    this.deactivate(victim);
    return victim;
  }

  private admit(slot: ReadoutSlot): boolean {
    if (this.activeCount <= this.visibleBudget()) return true;
    const victim = this.victimFor(slot.priority, true, slot);
    if (victim === undefined) return false;
    this.deactivate(victim);
    return true;
  }

  private enforceBudget(): void {
    const budget = this.visibleBudget();
    while (this.activeCount > budget) {
      let victim: ReadoutSlot | undefined;
      for (const slot of this.slots) {
        if (!slot.active || slot.label === '') continue;
        if (
          victim === undefined ||
          slot.priority < victim.priority ||
          (slot.priority === victim.priority && slot.age > victim.age)
        ) {
          victim = slot;
        }
      }
      if (victim === undefined) return;
      this.deactivate(victim);
    }
  }

  private victimFor(
    incomingPriority: number,
    visibleOnly: boolean,
    exclude?: ReadoutSlot,
  ): ReadoutSlot | undefined {
    let victim: ReadoutSlot | undefined;
    for (const slot of this.slots) {
      if (
        slot === exclude ||
        !slot.active ||
        (visibleOnly && slot.label === '') ||
        slot.priority > incomingPriority
      ) {
        continue;
      }
      if (
        victim === undefined ||
        slot.priority < victim.priority ||
        (slot.priority === victim.priority && slot.age > victim.age)
      ) {
        victim = slot;
      }
    }
    return victim;
  }

  private visibleBudget(): number {
    return Math.min(
      readoutBudget(
        this.layout?.width ?? Number.POSITIVE_INFINITY,
        this.layout?.height ?? Number.POSITIVE_INFINITY,
      ),
      this.slots.length,
    );
  }

  private lifeFor(slot: ReadoutSlot): number {
    return readoutLife(slot.priority);
  }

  private conceal(slot: ReadoutSlot): void {
    slot.label = '';
    slot.envelope = { halfWidth: 0, above: 0, below: 0 };
    slot.element.hidden = true;
    slot.element.className = 'damage-readout';
  }

  private deactivate(slot: ReadoutSlot): void {
    slot.active = false;
    this.conceal(slot);
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
      slot.envelope = readoutEnvelope(
        slot.label,
        layout.width,
        this.reducedMotion,
        layout.height,
      );
    }
    slot.element.style.left = `${String(slot.screen.x)}px`;
    slot.element.style.top = `${String(slot.screen.y)}px`;
  }

  private reflow(): void {
    const layout = this.layout;
    if (layout === null) return;
    const occupied = [];
    const visible = this.slots
      .filter((slot) => slot.active && slot.label !== '')
      .sort((left, right) => right.priority - left.priority || left.age - right.age);
    for (const slot of visible) {
      const screen = clampReadout(
        slot.anchor,
        slot.label,
        layout,
        this.reducedMotion,
        occupied,
      );
      slot.screen.x = screen.x;
      slot.screen.y = screen.y;
      slot.envelope = readoutEnvelope(
        slot.label,
        layout.width,
        this.reducedMotion,
        layout.height,
      );
      occupied.push(readoutBounds(slot.screen, slot.envelope));
      slot.element.style.left = `${String(slot.screen.x)}px`;
      slot.element.style.top = `${String(slot.screen.y)}px`;
    }
  }

  private labelFor(slot: ReadoutSlot): string {
    return readoutLabel(
      slot,
      compactReadouts(
        this.layout?.width ?? Number.POSITIVE_INFINITY,
        this.layout?.height ?? Number.POSITIVE_INFINITY,
      ),
    );
  }

  private paint(slot: ReadoutSlot, label: string, restart: boolean): void {
    const tone = readoutTone(slot.priority);
    const baseClass = `damage-readout ${tone}`;
    slot.element.textContent = label;
    slot.element.hidden = false;
    if (!restart && slot.element.className.includes('is-active')) {
      slot.element.className = `${baseClass} is-active`;
      return;
    }
    slot.element.className = baseClass;
    void slot.element.offsetWidth;
    slot.element.className += ' is-active';
  }
}
