import limits from './limits.json';

const KEY = 'array-stepper.draft.v1';
export interface Draft { source: string; entry: string; inputs: Record<string, string> }

export function loadDraft(): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value.source !== 'string' || value.source.length > limits.maxSource || typeof value.entry !== 'string') return null;
    if (!value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs)) return null;
    if (!Object.values(value.inputs).every((input) => typeof input === 'string')) return null;
    return value;
  } catch { return null; }
}
export function saveDraft(draft: Draft): void {
  try { localStorage.setItem(KEY, JSON.stringify(draft)); }
  catch { /* Private browsing or a full storage quota must not prevent editing. */ }
}
