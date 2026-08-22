import { useEffect, useRef, useState } from 'react';
import type { MechLocation } from '../../schema/common';
import type { Chassis } from '../../schema/chassis';
import type { Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import { ChassisSilhouette } from './ChassisSilhouette';
import { MechPreviewRenderer } from './MechPreviewRenderer';

const EMPTY_COMPATIBLE: ReadonlySet<MechLocation> = new Set();

export interface MechPreviewProps {
  catalog: Catalog;
  chassis: Chassis;
  design: Design;
  selected?: MechLocation | null;
  hovered?: MechLocation | null;
  compatible?: ReadonlySet<MechLocation>;
  onHoverLocation?: (location: MechLocation | null) => void;
  onSelectLocation?: (location: MechLocation) => void;
  className?: string;
  reducedMotion?: boolean;
}

/** React owns the host; the renderer owns every object placed inside it. */
export function MechPreview({
  catalog,
  chassis,
  design,
  selected = null,
  hovered = null,
  compatible = EMPTY_COMPATIBLE,
  onHoverLocation,
  onSelectLocation,
  className,
  reducedMotion,
}: MechPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MechPreviewRenderer | null>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolvedReducedMotion = reducedMotion ?? systemReducedMotion;

  useEffect(() => {
    if (reducedMotion !== undefined || typeof globalThis.matchMedia !== 'function') return;
    const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [reducedMotion]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let renderer: MechPreviewRenderer | null = null;
    const fail = (): void => {
      renderer?.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
      setFailed(true);
    };
    try {
      renderer = new MechPreviewRenderer(host, catalog, resolvedReducedMotion);
      renderer.setCallbacks({ onFailure: fail });
      rendererRef.current = renderer;
      setFailed(false);
    } catch {
      fail();
    }
    return () => {
      if (rendererRef.current === renderer) rendererRef.current = null;
      renderer?.destroy();
    };
  }, [catalog, resolvedReducedMotion]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    try {
      renderer.setMachine(chassis, design);
    } catch {
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
      setFailed(true);
    }
  }, [chassis, design, catalog, resolvedReducedMotion]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    const fail = (): void => {
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
      setFailed(true);
    };
    renderer.setCallbacks({ onHoverLocation, onSelectLocation, onFailure: fail });
  }, [onHoverLocation, onSelectLocation, catalog, resolvedReducedMotion]);

  useEffect(() => {
    rendererRef.current?.setHighlights({ selected, hovered, compatible });
  }, [selected, hovered, compatible, chassis, design, catalog, resolvedReducedMotion]);

  const classes = ['mech-preview', className].filter(Boolean).join(' ');
  return (
    <div ref={hostRef} className={classes} data-testid="mech-preview">
      {failed ? <ChassisSilhouette chassis={chassis} design={design} active={hovered ?? selected} /> : null}
    </div>
  );
}
