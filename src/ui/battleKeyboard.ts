const INTERACTIVE_TARGETS = [
  'a[href]',
  'button',
  'input',
  'select',
  'summary',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(',');

const TOGGLE_KEYS = new Set(['Space', 'KeyH', 'KeyP', 'KeyT']);

export interface BattleKeyContext {
  briefingSeen: boolean;
  interactiveTarget: boolean;
  code: string;
  repeat: boolean;
}

export function isInteractiveKeyTarget(target: EventTarget | null): boolean {
  const eventElement = target instanceof Element ? target : null;
  const activeElement = typeof document === 'undefined' ? null : document.activeElement;
  const element = eventElement ?? activeElement;
  return element instanceof Element && element.closest(INTERACTIVE_TARGETS) !== null;
}

export function shouldIgnoreBattleKey(context: BattleKeyContext): boolean {
  return (
    !context.briefingSeen ||
    context.interactiveTarget ||
    (context.repeat && TOGGLE_KEYS.has(context.code))
  );
}
