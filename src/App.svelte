<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import ArrayView from './components/ArrayView.svelte';
  import { PythonRunner } from './lib/runner';
  import { examples } from './lib/examples';
  import { arrays, changed, defaultArray, display, indexValue, POINTER_NAMES, pointerColor, previousFrame } from './lib/trace-view';
  import { loadDraft, saveDraft } from './lib/draft';
  import limits from './lib/limits.json';
  import type { Analysis, DisplayAtom, RecordedRun } from './lib/types';

  let source = $state<string>(examples[0].code);
  let entry = $state<string>(examples[0].entry);
  let inputs = $state<Record<string, string>>({ ...examples[0].inputs });
  let exampleId = $state<string>(examples[0].id);
  let analysis = $state.raw<Analysis>({ functions: [] });
  let analyzing = $state(true);
  let analyzedSource = $state('');
  let runtimeError = $state('');
  let busy = $state(false);
  let captured = $state(0);
  let run = $state.raw<RecordedRun | null>(null);
  let stepIndex = $state(0);
  let playing = $state(false);
  let speed = $state(2);
  let inspectedFrame = $state<number | null>(null);
  let arraySelections = $state<Record<string, string>>({});
  let bindings = $state<Record<string, string[]>>({});
  let mounted = $state(false);
  let runner: PythonRunner;
  let revision = 0;
  let analysisTimer: ReturnType<typeof setTimeout>;
  let saveTimer: ReturnType<typeof setTimeout>;

  const functions = $derived(analysis.functions);
  const selectedFunction = $derived(functions.find(f => f.name === entry));
  const canRun = $derived(!busy && !analyzing && analyzedSource === source && !!selectedFunction && !analysis.error);
  const steps = $derived(run?.steps ?? []);
  const step = $derived(steps[stepIndex]);
  const activeFrame = $derived(step?.frames.at(-1));
  const frame = $derived(step?.frames.find(f => f.id === inspectedFrame) ?? activeFrame);
  const frameArrays = $derived(arrays(frame));
  const selectedArray = $derived.by(() => {
    const selected = frame ? arraySelections[frame.key] : '';
    return frameArrays.some(([name]) => name === selected) ? selected : defaultArray(frame);
  });
  const values = $derived((frame?.locals[selectedArray] as DisplayAtom[] | undefined) ?? null);
  const previous = $derived(previousFrame(steps, stepIndex, frame));
  const previousArray = $derived(Array.isArray(previous?.locals[selectedArray]) ? previous!.locals[selectedArray] as DisplayAtom[] : undefined);
  const inputArrayName = $derived(selectedFunction?.parameters.find(parameter =>
    ((inputs[parameter.name]?.trim() || parameter.default) ?? '').startsWith('['))?.name ?? '');
  const bindingKey = $derived(`${frame?.key ?? selectedFunction?.key ?? ''}/${selectedArray || inputArrayName}`);
  const scopeKey = $derived(frame?.key ?? selectedFunction?.key);
  const candidateNames = $derived.by(() => {
    const key = scopeKey;
    const candidates = new Set(functions.find(f => f.key === key)?.locals ?? []);
    for (const recorded of steps) {
      for (const recordedFrame of recorded.frames) {
        if (recordedFrame.key !== key) continue;
        for (const [name, value] of Object.entries(recordedFrame.locals)) {
          if (indexValue(value) !== null) candidates.add(name);
        }
      }
    }
    return [...candidates].filter(name => name !== (selectedArray || inputArrayName)).sort();
  });
  const selectedPointers = $derived(bindings[bindingKey] ?? candidateNames.filter(name => POINTER_NAMES.has(name)));
  const pointers = $derived.by(() => selectedPointers.flatMap(name => {
    const index = indexValue(frame?.locals[name]);
    return index === null ? [] : [{ name, index, color: pointerColor(name, selectedPointers) }];
  }));
  const highlightLine = $derived(step?.line ?? null);
  const errorLine = $derived(analysis.error?.line ?? (run?.status === 'error' && (!steps.length || stepIndex === steps.length - 1) ? run.line : null));
  const atEnd = $derived(steps.length > 0 && stepIndex === steps.length - 1);

  function invalidate() {
    revision++;
    playing = false;
    runner?.stop();
    busy = false;
    captured = 0;
    run = null;
    stepIndex = 0;
    inspectedFrame = null;
    runtimeError = '';
  }
  function scheduleAnalysis() {
    clearTimeout(analysisTimer);
    analyzing = true;
    analyzedSource = '';
    analysisTimer = setTimeout(inspect, 300);
  }
  async function inspect() {
    const version = revision;
    const code = source;
    try {
      const result = await runner.analyze(code);
      if (version !== revision || source !== code) return;
      analysis = result;
      analyzedSource = code;
      if (!result.functions.some(f => f.name === entry)) entry = result.functions.length === 1 ? result.functions[0].name : '';
      ensureInputs();
    } catch (error) {
      if (version !== revision || (error instanceof Error && error.name === 'AbortError')) return;
      runtimeError = error instanceof Error ? error.message : String(error);
    } finally {
      if (version === revision) analyzing = false;
    }
  }
  function ensureInputs() {
    const fn = analysis.functions.find(f => f.name === entry);
    if (!fn) return;
    inputs = Object.fromEntries(fn.parameters.map((parameter, index) => [parameter.name,
      Object.hasOwn(inputs, parameter.name) ? inputs[parameter.name] : (parameter.required && index === 0 ? '[5, 6, 7, 1, 2, 3, 4]' : '')]));
  }
  function editSource(next: string) {
    if (next === source) return;
    invalidate();
    source = next;
    exampleId = '';
    analysis = { functions: [] };
    scheduleAnalysis();
  }
  function selectExample(id: string) {
    const example = examples.find(item => item.id === id);
    if (!example) return;
    invalidate();
    source = example.code;
    entry = example.entry;
    inputs = { ...example.inputs };
    exampleId = example.id;
    bindings = {};
    arraySelections = {};
    analysis = { functions: [] };
    scheduleAnalysis();
  }
  function selectFunction(name: string) {
    invalidate();
    entry = name;
    ensureInputs();
  }
  function editInput(name: string, value: string) {
    invalidate();
    inputs = { ...inputs, [name]: value };
    // If the input changed during source analysis, restart that cancelled analysis.
    if (analyzing) scheduleAnalysis();
  }
  async function record() {
    if (!canRun) return;
    playing = false;
    busy = true;
    captured = 0;
    run = null;
    stepIndex = 0;
    inspectedFrame = null;
    runtimeError = '';
    const version = ++revision;
    try {
      const result = await runner.record(source, entry, { ...inputs }, count => {
        if (version === revision) captured = count;
      });
      if (version !== revision) return;
      run = result;
    } catch (error) {
      if (version === revision) runtimeError = error instanceof Error ? error.message : String(error);
    } finally {
      if (version === revision) busy = false;
    }
  }
  function go(index: number) {
    playing = false;
    inspectedFrame = null;
    stepIndex = Math.max(0, Math.min(steps.length - 1, index));
  }
  function togglePlay() {
    if (!steps.length) return;
    if (atEnd) stepIndex = 0;
    inspectedFrame = null;
    playing = !playing;
  }
  function togglePointer(name: string) {
    bindings = { ...bindings, [bindingKey]: selectedPointers.includes(name)
      ? selectedPointers.filter(item => item !== name) : [...selectedPointers, name] };
  }
  function keyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault(); void record(); return;
    }
    if (target.closest('input, textarea, select, button, .cm-editor, .array-scroll, [contenteditable="true"]')) return;
    if (!steps.length) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(stepIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(stepIndex + 1); }
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  }

  onMount(() => {
    runner = new PythonRunner();
    const saved = loadDraft();
    if (saved) {
      source = saved.source;
      entry = saved.entry;
      inputs = saved.inputs;
      exampleId = examples.find(example => example.code === source)?.id ?? '';
    }
    mounted = true;
    void inspect();
    return () => {
      revision++;
      clearTimeout(analysisTimer);
      clearTimeout(saveTimer);
      runner.stop();
    };
  });
  $effect(() => {
    if (!mounted) return;
    const draft = { source, entry, inputs: { ...inputs } };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft(draft), 300);
  });
  $effect(() => {
    if (!playing) return;
    const delay = 1000 / speed;
    const timer = setInterval(() => {
      if (stepIndex >= steps.length - 1) playing = false;
      else { inspectedFrame = null; stepIndex++; }
    }, delay);
    return () => clearInterval(timer);
  });
</script>

<svelte:window onkeydown={keyboard} />

<div class="app-shell">
  <header class="app-header">
    <a class="brand" href="./" aria-label="Array Stepper home"><span class="brand-mark" aria-hidden="true">[<span>▸</span>]</span><span>array<span class="brand-light">stepper</span></span></a>
    <div class="header-right"><span class="local-badge"><i></i> Local Python runtime</span><span class="version-label">WORKSPACE / 01</span></div>
  </header>

  <main>
    <section class="workspace-heading" aria-label="Workspace introduction">
      <div><div class="eyebrow">PYTHON EXECUTION, MADE VISIBLE</div><h1>One line. One state.</h1><p>Paste your algorithm. Follow the data.</p></div>
      <label class="example-picker"><span>Load an example</span><select aria-label="Load an example" value={exampleId} onchange={e => selectExample(e.currentTarget.value)} disabled={busy}>
        <option value="" disabled>Your code</option>{#each examples as example}<option value={example.id}>{example.name}</option>{/each}
      </select></label>
    </section>

    <div class="workspace-grid">
      <section class="panel source-panel" aria-labelledby="source-title">
        <div class="panel-heading"><h2 id="source-title"><span class="panel-number">01</span> Source</h2><span class="file-label"><i></i> algorithm.py</span></div>
        <div class="source-tools">
          <label><span class="field-label">Entry function</span><select aria-label="Entry function" value={entry} onchange={e => selectFunction(e.currentTarget.value)} disabled={busy || analyzing || !functions.length}>
            {#if !entry}<option value="">Select a function…</option>{/if}
            {#each functions as fn}<option value={fn.name}>{fn.name}({fn.parameters.map(p => p.name).join(', ')})</option>{/each}
          </select></label>
          <span class="language-label">Python <span>3.14</span></span>
        </div>
        <CodeEditor code={source} onchange={editSource} line={highlightLine} {errorLine} event={step?.event ?? 'line'} />
        <div class="editor-caption"><span>{source.split('\n').length} lines <span class="divider">/</span> Editable source</span><span>{analyzing ? 'Reading functions…' : 'Changes clear the recording'}</span></div>
        <div class="inputs-section">
          <div class="section-label"><span>FUNCTION INPUTS</span><span>JSON values</span></div>
          {#if selectedFunction}
            <div class="input-fields">
              {#each selectedFunction.parameters as parameter}
                <label class="argument-field"><span class="argument-name">{parameter.name}{#if !parameter.required}<small>optional</small>{/if}</span>
                  <input aria-label={`Input ${parameter.name}`} value={inputs[parameter.name] ?? ''}
                    placeholder={parameter.required ? 'Enter a JSON value' : `Default: ${parameter.default ?? 'Python default'}`}
                    spellcheck="false" oninput={e => editInput(parameter.name, e.currentTarget.value)} />
                </label>
              {/each}
            </div>
          {:else}<p class="input-hint">{analyzing ? 'Loading Python and reading function parameters…' : 'Select a function to configure its inputs.'}</p>{/if}
          <div class="run-row"><span class="run-hint">{busy ? (captured ? `${captured.toLocaleString()} steps captured…` : 'Preparing Python…') : 'One numeric array + scalar arguments'}</span>
            {#if busy}<button class="button danger" onclick={() => runner.stop()}><span aria-hidden="true">■</span> Stop recording</button>
            {:else}<button class="button primary" onclick={record} disabled={!canRun}><span aria-hidden="true">▶</span> Record run</button>{/if}
          </div>
        </div>
      </section>

      <section class="panel state-panel" aria-labelledby="state-title">
        <div class="panel-heading"><h2 id="state-title"><span class="panel-number">02</span> State</h2><span class="step-badge">{step ? `Step ${stepIndex + 1} / ${steps.length}` : 'Ready to explore'}</span></div>
        <div class="state-content">
          <div class="state-context"><div><span class="field-label">{frame ? `${frame.name}() · call #${frame.id}` : 'ARRAY'}</span>
            {#if frameArrays.length}<select class="array-selector" aria-label="Displayed array" value={selectedArray} onchange={e => { arraySelections = { ...arraySelections, [frame!.key]: e.currentTarget.value }; }}>
              {#each frameArrays as [name]}<option value={name}>{name}</option>{/each}
            </select>{:else}<span class="no-array">{frame ? 'No numeric array in this frame' : 'Waiting for a recording'}</span>{/if}
          </div><span class="event-label" class:event-exception={step?.event === 'exception' || step?.event === 'unwind'}>{step ? step.event === 'line' ? `Before line ${step.line}` : step.event === 'return' ? `Return · line ${step.line}` : step.event === 'unwind' ? `Error exit · line ${step.line}` : `Exception · line ${step.line}` : 'BEFORE-LINE SNAPSHOTS'}</span></div>
          <ArrayView {values} previous={previousArray} {pointers} />

          <div class="subpanel variables-panel">
            <div class="subpanel-heading"><h3>Variables</h3><span>{frame ? `${Object.keys(frame.locals).length} in scope` : 'Current call frame'}</span></div>
            {#if frame}
              <div class="variables-grid">
                {#each Object.entries(frame.locals) as [name, value]}
                  <div class="variable" class:variable-changed={changed(value, previous?.locals[name])} title={`${name} = ${display(value)}`}>
                    <span class="variable-name">{name}</span><span class="variable-equals">=</span><span class="variable-value" style={selectedPointers.includes(name) ? `color: ${pointerColor(name, selectedPointers)}` : ''}>{display(value)}</span>
                  </div>
                {/each}
                {#if step?.event === 'return' && frame.id === activeFrame?.id}
                  <div class="variable return-variable" title={`Return value: ${display(step.value)}`}><span class="variable-name">return</span><span class="variable-equals">→</span><span class="variable-value">{display(step.value)}</span></div>
                {/if}
              </div>
            {:else}<p class="empty-copy">Variables appear as your function executes.</p>{/if}
          </div>

          <details class="subpanel pointer-config">
            <summary><span>Index pointers</span><span>{selectedPointers.length} selected <span class="chevron">⌄</span></span></summary>
            <p>Choose variables that represent indices. Arrows appear when their values are integers.</p>
            <div class="pointer-options">
              {#each candidateNames as name}
                <label class="pointer-option" style={`--pointer-color: ${pointerColor(name, selectedPointers)}`}><input type="checkbox" checked={selectedPointers.includes(name)} onchange={() => togglePointer(name)} /><span>{name}</span></label>
              {:else}<span class="empty-copy">No variables discovered yet.</span>{/each}
            </div>
            <p class="boundary-note">Arrows use literal indices. Negative positions stay left of the array; Python indexing still follows Python rules.</p>
          </details>

          <div class="subpanel stack-panel"><div class="subpanel-heading"><h3>Call stack</h3><span>{step ? `${step.frames.length} ${step.frames.length === 1 ? 'frame' : 'frames'}` : 'No active calls'}</span></div>
            {#if step}<div class="stack-frames">{#each step.frames as item, index}
              {#if index > 0}<span class="stack-arrow" aria-hidden="true">→</span>{/if}
              <button class="stack-frame" class:frame-selected={item.id === frame?.id} onclick={() => { inspectedFrame = item.id; }} title={`Inspect ${item.name}, call ${item.id}`}>
                <span>{item.name}</span><small>#{item.id}{item.id === activeFrame?.id ? ' · active' : ''}</small>
              </button>
            {/each}</div>{:else}<p class="empty-copy">Helper calls and recursion stay in their own scopes.</p>{/if}
          </div>
        </div>
      </section>
    </div>

    {#if analysis.error || runtimeError}
      <div class="notice error" role="alert"><span class="notice-icon">!</span><div><strong>{analysis.error ? 'Source needs attention' : 'Runtime unavailable'}</strong><p>{analysis.error?.message ?? runtimeError}</p></div>{#if runtimeError}<button class="button" onclick={() => { runtimeError = ''; analyzing = true; void inspect(); }}>Retry</button>{/if}</div>
    {/if}
    {#if run}
      <div class="notice" class:error={run.status === 'error'} class:warning={run.status === 'limited' || run.status === 'cancelled'} role="status">
        <span class="notice-icon">{run.status === 'complete' ? '✓' : '!'}</span>
        <div><strong>{run.status === 'complete' ? (atEnd ? `Returned ${display(run.result)}` : 'Recording complete') : 'Incomplete recording'}</strong>
          <p>{run.status === 'complete' ? `${steps.length} steps · ${Math.round(run.elapsedMs)} ms · Use the controls to explore.` : run.message}</p>
        </div>
        {#if run.status !== 'complete' && steps.length}<button class="button" onclick={() => go(steps.length - 1)}>Last captured step →</button>{/if}
      </div>
    {/if}
    {#if step?.event === 'exception' || step?.event === 'unwind'}<div class="exception-detail">Exception at this step: <code>{step.message}</code><span>{step.event === 'unwind' ? 'This function call exited because of the exception.' : 'The function can still handle this exception.'}</span></div>{/if}
    {#if run?.output}<details class="output-panel"><summary>Captured output</summary><pre>{run.output}</pre></details>{/if}

    <section class="playback-bar" aria-label="Playback controls">
      <div class="playback-buttons">
        <button class="icon-button" aria-label="First step" title="First step" disabled={!steps.length || stepIndex === 0} onclick={() => go(0)}>↤</button>
        <button class="icon-button" aria-label="Previous step" title="Previous step (←)" disabled={!steps.length || stepIndex === 0} onclick={() => go(stepIndex - 1)}>‹</button>
        <button class="play-button" aria-label={playing ? 'Pause playback' : 'Play recording'} title="Play / pause (Space)" disabled={!steps.length} onclick={togglePlay}>{playing ? 'Ⅱ' : '▶'}</button>
        <button class="icon-button" aria-label="Next step" title="Next step (→)" disabled={!steps.length || atEnd} onclick={() => go(stepIndex + 1)}>›</button>
        <button class="icon-button" aria-label="Last step" title="Last step" disabled={!steps.length || atEnd} onclick={() => go(steps.length - 1)}>↦</button>
      </div>
      <div class="timeline"><input type="range" aria-label="Execution timeline" min="0" max={Math.max(0, steps.length - 1)} value={stepIndex} disabled={!steps.length} oninput={e => go(Number(e.currentTarget.value))} /><span>{steps.length ? `${stepIndex + 1} / ${steps.length}` : 'No recording'}</span></div>
      <label class="speed-control"><span>Speed</span><select aria-label="Playback speed" bind:value={speed}><option value={1}>1 step/s</option><option value={2}>2 steps/s</option><option value={4}>4 steps/s</option><option value={8}>8 steps/s</option></select></label>
    </section>

    <footer class="workspace-footer"><span>Python runs on your device. Run only code you trust.</span><span>← → Step <span class="divider">/</span> Space Play <span class="divider">/</span> {limits.maxSteps.toLocaleString()} steps · {limits.maxSeconds} sec limit</span></footer>
  </main>
</div>
