<script lang="ts">
  import type { DisplayAtom } from '../lib/types';
  import { changed, display } from '../lib/trace-view';
  let { values, previous, pointers = [] }: {
    values: DisplayAtom[] | null;
    previous?: DisplayAtom[];
    pointers?: { name: string; index: number | string; color: string }[];
  } = $props();
  let slots = $derived.by(() => {
    if (!values) return [];
    return Array.from({ length: values.length + 2 }, (_, position) => ({
      index: position - 1,
      boundary: position === 0 || position === values!.length + 1,
      pointers: pointers.filter(p => {
        const index = typeof p.index === 'number' ? p.index : p.index.startsWith('-') ? -Infinity : Infinity;
        return Math.max(0, Math.min(values!.length + 1, index + 1)) === position;
      }),
    }));
  });
  let lanes = $derived(Math.max(1, ...slots.map(slot => slot.pointers.length)));
</script>

{#if values === null}
  <div class="diagram-empty">
    <div class="ghost-array" aria-hidden="true"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span></div>
    <p>Your array will appear here.</p>
    <span>Choose a function, enter its inputs, then record a run.</span>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need focus to scroll wide arrays.) -->
  <div class="array-scroll" role="region" aria-label="Array visualization" tabindex="0">
    <div class="array-strip" style={`--pointer-height: ${lanes * 32 + 36}px`}>
      {#each slots as slot (slot.index)}
        <div class="array-slot" class:boundary={slot.boundary}>
          <div class="pointer-zone">
            {#each slot.pointers as pointer (pointer.name)}
              <div class="pointer-tag" style={`--pointer-color: ${pointer.color}`} title={`${pointer.name} = ${pointer.index}`}>
                <span>{pointer.name}</span>{#if slot.boundary}<small> · {pointer.index}</small>{/if}
              </div>
            {/each}
            {#if slot.pointers.length}
              <span class="pointer-stem" style={`--pointer-color: ${slot.pointers.at(-1)?.color}`} aria-hidden="true"></span>
            {/if}
          </div>
          <span class="cell-index">{slot.boundary ? (slot.index < 0 ? '−1' : values.length) : slot.index}</span>
          <div class="array-cell" class:cell-changed={!slot.boundary && previous !== undefined && (slot.index >= previous.length || changed(values[slot.index], previous[slot.index]))}
            title={slot.boundary ? 'Boundary position. Not an array element.' : `array[${slot.index}] = ${display(values[slot.index])}`}
            data-testid={slot.boundary ? 'boundary-cell' : 'array-cell'}>
            {#if slot.boundary}<span class="boundary-dot">·</span>{:else}{display(values[slot.index])}{/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
  <div class="array-legend">
    <span>{values.length === 0 ? 'Empty array' : `${values.length} elements`} <span class="muted">· zero-based indices</span></span>
    <span><i class="legend-cell"></i> Changed <i class="legend-boundary"></i> Boundary</span>
  </div>
{/if}
