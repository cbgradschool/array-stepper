import type { DisplayAtom, Frame, TraceStep, Value } from './types';

export const POINTER_NAMES = new Set(['left', 'right', 'mid', 'i', 'j', 'k', 'lo', 'hi', 'low', 'high', 'start', 'end', 'slow', 'fast']);
export const POINTER_COLORS = ['#6eebbb', '#6ca9ff', '#ff7b94', '#c4a1ff', '#ffc578', '#70d8e5'];
export const pointerColor = (name: string, names: string[]) => {
  if (['left', 'lo', 'low', 'start'].includes(name)) return POINTER_COLORS[0];
  if (name === 'mid') return POINTER_COLORS[1];
  if (['right', 'hi', 'high', 'end'].includes(name)) return POINTER_COLORS[2];
  return POINTER_COLORS[Math.max(0, names.indexOf(name)) % POINTER_COLORS.length];
};
export function display(value: Value | undefined): string {
  if (value === undefined) return 'not defined';
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '-0.0' : String(value);
  if (Array.isArray(value)) return `[${value.map(display).join(', ')}]`;
  return value.text;
}
export function arrays(frame: Frame | undefined): [string, DisplayAtom[]][] {
  if (!frame) return [];
  return Object.entries(frame.locals).filter((pair): pair is [string, DisplayAtom[]] => Array.isArray(pair[1]));
}
export function defaultArray(frame: Frame | undefined): string {
  const available = arrays(frame);
  return available.find(([name]) => frame?.parameters.includes(name))?.[0] ?? available[0]?.[0] ?? '';
}
export function previousFrame(steps: TraceStep[], index: number, frame: Frame | undefined): Frame | undefined {
  if (!frame || index < 1) return undefined;
  return steps[index - 1]?.frames.find((candidate) => candidate.id === frame.id);
}
export function changed(current: Value | undefined, previous: Value | undefined): boolean {
  return previous !== undefined && JSON.stringify(current) !== JSON.stringify(previous);
}
export function indexValue(value: Value | undefined): number | string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  // Exact Python integers beyond JavaScript's safe range still belong in a
  // boundary lane. Keep their text instead of rounding or hiding the pointer.
  if (value && !Array.isArray(value) && typeof value === 'object' && value.kind === 'number' && /^-?\d+$/.test(value.text)) return value.text;
  return null;
}
