import type { Analysis, RecordedRun, TraceStep, WorkerResponse } from './types';
import limits from './limits.json';

type Pending =
  | { kind: 'analysis'; id: number; resolve: (value: Analysis) => void; reject: (error: Error) => void }
  | { kind: 'record'; id: number; steps: TraceStep[]; started: number; progress: (count: number) => void;
      resolve: (value: RecordedRun) => void; reject: (error: Error) => void };

const aborted = () => new DOMException('Operation cancelled.', 'AbortError');

/** Owns the worker lifetime. Callers receive recordings, never worker messages.
 * A completed run discards its interpreter so user mutations cannot leak into
 * the next run. Stop and timeouts retain only the prefix delivered so far.
 */
export class PythonRunner {
  private worker: Worker | null = null;
  private boot: Promise<void> | null = null;
  private rejectBoot: ((error: Error) => void) | null = null;
  private readyBoot: (() => void) | null = null;
  private pending: Pending | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private runTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private generation = 0;

  private ready(): Promise<void> {
    if (this.boot) return this.boot;
    this.boot = new Promise<void>((resolve, reject) => {
      this.readyBoot = resolve;
      this.rejectBoot = reject;
    });
    const boot = this.boot;
    try {
      const worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (this.worker !== worker) return;
        this.receive(data);
      };
      worker.onerror = (event) => {
        if (this.worker === worker) this.fail(new Error(event.message || 'Python worker failed to load.'));
      };
      worker.postMessage({ type: 'init', base: new URL('pyodide/', document.baseURI).href });
      this.bootTimer = setTimeout(() => this.fail(new Error('Python startup timed out. Reload the page to retry.')), 90_000);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return boot;
  }

  async analyze(source: string): Promise<Analysis> {
    if (this.pending) this.stop();
    const generation = this.generation;
    await this.ready();
    if (generation !== this.generation) throw aborted();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending = { kind: 'analysis', id, resolve, reject };
      this.worker!.postMessage({ type: 'analyze', id, source });
    });
  }

  async record(source: string, entry: string, inputs: Record<string, string>, progress = (_count: number) => {}): Promise<RecordedRun> {
    if (this.pending) this.stop();
    const generation = this.generation;
    try {
      await this.ready();
      if (generation !== this.generation) throw aborted();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { status: 'cancelled', message: 'Recording stopped.', steps: [], output: '', elapsedMs: 0 };
      }
      throw error;
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending = { kind: 'record', id, steps: [], started: 0, progress, resolve, reject };
      this.worker!.postMessage({ type: 'record', id, source, entry, inputs });
    });
  }

  stop(): void {
    const pending = this.pending;
    const rejectBoot = this.rejectBoot;
    this.shutdown();
    rejectBoot?.(aborted());
    if (pending?.kind === 'record') {
      pending.resolve({ status: 'cancelled', message: 'Recording stopped. Showing the captured steps.',
        steps: pending.steps, output: '', elapsedMs: pending.started ? performance.now() - pending.started : 0 });
    } else pending?.reject(aborted());
  }

  private receive(message: WorkerResponse): void {
    if (message.type === 'ready') {
      if (this.bootTimer) clearTimeout(this.bootTimer);
      this.bootTimer = null;
      this.readyBoot?.();
      return;
    }
    if (message.type === 'fatal') {
      this.fail(new Error(message.message));
      return;
    }
    const pending = this.pending;
    if (!pending || pending.id !== message.id) return;
    if (message.type === 'analysis' && pending.kind === 'analysis') {
      this.pending = null;
      pending.resolve(message.analysis);
    } else if (pending.kind === 'record') {
      if (message.type === 'started') {
        pending.started = performance.now();
        this.runTimer = setTimeout(() => {
          if (this.pending !== pending) return;
          this.shutdown();
          pending.resolve({ status: 'limited', message: `Execution limit reached (${limits.maxSeconds} seconds). Showing the captured steps.`,
            steps: pending.steps, output: '', elapsedMs: limits.maxSeconds * 1_000 });
        }, limits.maxSeconds * 1_000);
      } else if (message.type === 'chunk') {
        pending.steps.push(...message.steps);
        pending.progress(pending.steps.length);
      } else if (message.type === 'finished') {
        this.shutdown();
        pending.resolve({ ...message.outcome, steps: pending.steps });
      }
    }
  }

  private fail(error: Error): void {
    const pending = this.pending;
    const rejectBoot = this.rejectBoot;
    this.shutdown();
    rejectBoot?.(error);
    if (pending?.kind === 'record' && pending.steps.length) {
      pending.resolve({ status: 'error', message: error.message, steps: pending.steps, output: '', elapsedMs: 0 });
    } else pending?.reject(error);
  }

  private shutdown(): void {
    this.generation++;
    this.worker?.terminate();
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.runTimer) clearTimeout(this.runTimer);
    this.worker = null;
    this.pending = null;
    this.boot = null;
    this.rejectBoot = null;
    this.readyBoot = null;
    this.bootTimer = null;
    this.runTimer = null;
  }
}
