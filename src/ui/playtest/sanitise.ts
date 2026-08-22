export const MAX_PLAYTEST_NOTE_LENGTH = 500;

const EMAIL_ADDRESS = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gu;
const WEB_ADDRESS = /\b(?:https?:\/\/|www\.)\S+/giu;
const PHONE_LIKE = /\+?\d[\d().\s-]{5,}\d/gu;

function redactLongNumber(match: string): string {
  const digits = match.replace(/\D/gu, '');
  return digits.length >= 7 ? '[number removed]' : match;
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && !(code >= 127 && code <= 159));
    })
    .join('');
}

export function sanitisePlaytestNote(input: string): string {
  const redacted = stripControlCharacters(input)
    .replace(EMAIL_ADDRESS, '[email removed]')
    .replace(WEB_ADDRESS, '[link removed]')
    .replace(PHONE_LIKE, redactLongNumber)
    .replace(/\s+/gu, ' ')
    .trim();
  return [...redacted].slice(0, MAX_PLAYTEST_NOTE_LENGTH).join('').trim();
}
