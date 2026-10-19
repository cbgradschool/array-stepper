export type Scalar = number | boolean | string | null;
export type DisplayAtom = Scalar | { kind: 'number' | 'summary'; text: string };
export type Value = DisplayAtom | DisplayAtom[];

export interface Parameter {
  name: string;
  kind: 'positional' | 'keyword';
  required: boolean;
  default: string | null;
}
export interface FunctionInfo {
  name: string;
  key: string;
  line: number;
  parameters: Parameter[];
  locals: string[];
}
export interface Analysis {
  functions: FunctionInfo[];
  error?: { message: string; line: number | null };
}
export interface Frame {
  id: number;
  key: string;
  name: string;
  line: number;
  parameters: string[];
  locals: Record<string, Value>;
}
export interface TraceStep {
  event: 'line' | 'return' | 'exception' | 'unwind';
  line: number;
  frames: Frame[];
  value?: Value;
  message?: string;
}
export type RunStatus = 'complete' | 'error' | 'limited' | 'cancelled';
export interface RunOutcome {
  status: RunStatus;
  message: string;
  line?: number | null;
  result?: Value;
  output: string;
  elapsedMs: number;
}
export interface RecordedRun extends RunOutcome {
  steps: TraceStep[];
}
export type WorkerRequest =
  | { type: 'init'; base: string }
  | { type: 'analyze'; id: number; source: string }
  | { type: 'record'; id: number; source: string; entry: string; inputs: Record<string, string> };
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'analysis'; id: number; analysis: Analysis }
  | { type: 'started'; id: number }
  | { type: 'chunk'; id: number; steps: TraceStep[] }
  | { type: 'finished'; id: number; outcome: RunOutcome };
