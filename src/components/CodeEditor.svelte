<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, StateEffect, StateField } from '@codemirror/state';
  import { Decoration, EditorView, drawSelection, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
  import { python } from '@codemirror/lang-python';
  import { tags } from '@lezer/highlight';

  let { code, onchange, line = null, errorLine = null, event = 'line' }: {
    code: string; onchange: (source: string) => void;
    line?: number | null; errorLine?: number | null; event?: string;
  } = $props();
  let host: HTMLDivElement;
  let editor = $state.raw<EditorView | null>(null);
  let externalChange = false;
  const mark = StateEffect.define<{ line: number | null; error: number | null; event: string }>();
  const marks = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      value = value.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (!effect.is(mark)) continue;
        const decorations = [];
        const { line, error, event } = effect.value;
        if (line && line <= transaction.state.doc.lines) {
          decorations.push(Decoration.line({ attributes: { class: `execution-line event-${event}` } }).range(transaction.state.doc.line(line).from));
        }
        if (error && error !== line && error <= transaction.state.doc.lines) {
          decorations.push(Decoration.line({ attributes: { class: 'execution-error' } }).range(transaction.state.doc.line(error).from));
        }
        value = Decoration.set(decorations, true);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const colors = HighlightStyle.define([
    { tag: tags.keyword, color: '#c893ff' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#87d7ef' },
    { tag: tags.string, color: '#edbd7c' },
    { tag: [tags.number, tags.bool, tags.null], color: '#7ce3ce' },
    { tag: tags.comment, color: '#77869d', fontStyle: 'italic' },
    { tag: [tags.typeName, tags.className], color: '#74baff' },
    { tag: [tags.operator, tags.punctuation], color: '#a9bce0' },
  ]);

  onMount(() => {
    editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), history(), drawSelection(), indentOnInput(),
          bracketMatching(), python(), syntaxHighlighting(colors), marks,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorState.tabSize.of(4),
          EditorView.contentAttributes.of({ 'aria-label': 'Python code', 'aria-multiline': 'true', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !externalChange) onchange(update.state.doc.toString());
          }),
          EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent', color: '#d1dcf0' } }, { dark: true }),
        ],
      }),
    });
    return () => editor?.destroy();
  });

  $effect(() => {
    if (!editor || editor.state.doc.toString() === code) return;
    externalChange = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
    externalChange = false;
  });
  $effect(() => {
    if (!editor) return;
    const effects: StateEffect<unknown>[] = [mark.of({ line, error: errorLine, event })];
    if (line && line <= editor.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: 'nearest' }));
    }
    editor.dispatch({ effects });
  });
</script>

<div class="code-editor" bind:this={host}></div>
