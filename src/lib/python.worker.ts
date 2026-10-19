/// <reference lib="webworker" />
import type { PyodideAPI } from 'pyodide';
import type { WorkerRequest, WorkerResponse, TraceStep, RunOutcome } from './types';
import tracer from './tracer.py?raw';
import limits from './limits.json';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let python: PyodideAPI;
const send = (message: WorkerResponse) => scope.postMessage(message);

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'init') {
      const { loadPyodide } = await import(/* @vite-ignore */ `${data.base}pyodide.mjs`);
      python = await loadPyodide({ indexURL: data.base });
      python.globals.set('_runtime_limits_json', JSON.stringify(limits));
      python.runPython(tracer);
      send({ type: 'ready' });
      return;
    }
    python.globals.set('_source', data.source);
    if (data.type === 'analyze') {
      const analysis = JSON.parse(python.runPython('json.dumps(analyze(_source))'));
      send({ type: 'analysis', id: data.id, analysis });
      return;
    }

    let batch: TraceStep[] = [];
    let lastSent = 0;
    const flush = () => {
      if (!batch.length) return;
      send({ type: 'chunk', id: data.id, steps: batch });
      batch = [];
      lastSent = performance.now();
    };
    python.globals.set('_emit_trace', (json: string) => {
      const step: TraceStep = JSON.parse(json);
      batch.push(step);
      if (!lastSent || batch.length >= 32 || performance.now() - lastSent > 24 || step.event === 'exception') flush();
    });
    python.globals.set('_entry', data.entry);
    python.globals.set('_raw', JSON.stringify(data.inputs));
    send({ type: 'started', id: data.id });
    let outcome: RunOutcome;
    try {
      outcome = JSON.parse(python.runPython(
        'json.dumps(record(_source, _entry, json.loads(_raw), _emit_trace), allow_nan=False)',
      ));
    } catch (error) {
      outcome = { status: 'error', message: String(error), output: '', elapsedMs: 0 };
    }
    flush();
    send({ type: 'finished', id: data.id, outcome });
  } catch (error) {
    send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
  }
};
