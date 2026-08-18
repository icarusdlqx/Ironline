import { useEffect, useState } from 'react';

export const COMPACT_LAYOUT_QUERY =
  '(max-width: 640px), (pointer: coarse) and (max-width: 940px)';

function compactNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(COMPACT_LAYOUT_QUERY).matches === true;
}

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(compactNow);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const update = (): void => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}
