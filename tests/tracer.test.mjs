import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPyodide } from 'pyodide';

let python;
before(async () => {
  python = await loadPyodide();
  python.globals.set('_runtime_limits_json', await readFile(new URL('../src/lib/limits.json', import.meta.url), 'utf8'));
  python.runPython(await readFile(new URL('../src/lib/tracer.py', import.meta.url), 'utf8'));
});

function analyze(source) {
  python.globals.set('_source', source);
  return JSON.parse(python.runPython('json.dumps(analyze(_source))'));
}
function run(source, inputs = { array: '[5, 6, 7, 1, 2, 3, 4]' }, entry = 'search', limits = {}) {
  const steps = [];
  python.globals.set('_source', source);
  python.globals.set('_entry', entry);
  python.globals.set('_inputs', JSON.stringify(inputs));
  python.globals.set('_limits', JSON.stringify(limits));
  python.globals.set('_emit', (payload) => steps.push(JSON.parse(payload)));
  const outcome = JSON.parse(python.runPython('json.dumps(record(_source, _entry, json.loads(_inputs), _emit, **json.loads(_limits)))'));
  return { ...outcome, steps };
}
const rotated = `def search(array):
    if not array:
        raise ValueError("array must not be empty")
    left, right = 0, len(array)
    while left < right:
        mid = (left + right) // 2
        if array[mid] >= array[0]:
            left = mid + 1
        else:
            right = mid
    return left - 1
`;

test('discovers functions and defaults without executing code', () => {
  const info = analyze('def helper(array, /, target=7, *, reverse=False):\n    i = 0\n    return array\n');
  assert.equal(info.functions[0].name, 'helper');
  assert.deepEqual(info.functions[0].parameters.map(p => [p.name, p.required, p.default]), [
    ['array', true, null], ['target', false, '7'], ['reverse', false, 'false'],
  ]);
  assert(info.functions[0].locals.includes('i'));
});

test('reports syntax errors with a line number', () => {
  const result = analyze('def broken(:\n  pass');
  assert(result.error);
  assert.equal(result.error.line, 1);
});

test('unsupported constructs have explicit errors', () => {
  for (const code of ['import numpy\ndef f(array): return array', 'async def f(array): return array',
    'def f(array): yield 1', 'def f(*args): pass', 'print(3)', 'class Solution: pass',
    'def f(array=make()): return array']) {
    assert(analyze(code).error, code);
  }
});

test('records actual before-line state and the return value', () => {
  const result = run(rotated);
  assert.equal(result.status, 'complete');
  assert.equal(result.result, 2);
  const midLine = result.steps.find(s => s.line === 6);
  assert.equal(midLine.frames[0].locals.left, 0);
  assert.equal(midLine.frames[0].locals.right, 7);
  assert.equal(midLine.frames[0].locals.mid, undefined);
  const condition = result.steps.find(s => s.line === 7);
  assert.equal(condition.frames[0].locals.mid, 3);
  assert.equal(result.steps.at(-1).event, 'return');
});

test('handles non-rotated, single-element, negative, and empty inputs', () => {
  for (const [array, expected] of [['[1, 2, 3]', 2], ['[8]', 0], ['[-2, -1, -5, -4]', 1]]) {
    assert.equal(run(rotated, { array }).result, expected);
  }
  const empty = run(rotated, { array: '[]' });
  assert.equal(empty.status, 'error');
  assert.match(empty.message, /array must not be empty/);
  assert.equal(empty.line, 3);
  assert(empty.steps.length > 0);
});

test('array snapshots do not change after swaps, append, or pop', () => {
  const result = run(`def search(array):
    array[0], array[1] = array[1], array[0]
    array.append(9)
    array.pop(0)
    return array
`, { array: '[1, 2]' });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.steps[0].frames[0].locals.array, [1, 2]);
  assert.deepEqual(result.steps[1].frames[0].locals.array, [2, 1]);
  assert.deepEqual(result.steps[2].frames[0].locals.array, [2, 1, 9]);
  assert.deepEqual(result.result, [1, 9]);
});

test('recursion separates frame identities and sliced arrays', () => {
  const result = run(`def search(array):
    if not array:
        return 0
    return array[0] + search(array[1:])
`, { array: '[1, 2, 3]' });
  assert.equal(result.result, 6);
  const nested = result.steps.find(s => s.frames.length === 3);
  assert.equal(new Set(nested.frames.map(f => f.id)).size, 3);
  assert.deepEqual(nested.frames.map(f => f.locals.array), [[1, 2, 3], [2, 3], [3]]);
});

test('helper calls and caller mutation remain visible', () => {
  const result = run(`def helper(values):
    values.append(4)
    return values

def search(array):
    helper(array)
    return array
`, { array: '[1, 2]' });
  assert.deepEqual(result.result, [1, 2, 4]);
  assert(result.steps.some(s => s.frames.at(-1).name === 'helper'));
  assert.deepEqual(result.steps[0].frames[0].locals.array, [1, 2]);
});

test('supports defaults and positional-only/keyword-only arguments', () => {
  const code = 'def search(array, /, target=2, *, reverse=False):\n    return array.index(target) if not reverse else -1';
  assert.equal(run(code, { array: '[1, 2, 3]', target: '', reverse: '' }).result, 1);
  assert.equal(run(code, { array: '[1, 2, 3]', reverse: 'true' }).result, -1);
});

test('does not treat a handled exception as a failed run', () => {
  const result = run(`def search(array):
    try:
        value = array[100]
    except IndexError:
        return -1
`);
  assert.equal(result.status, 'complete');
  assert.equal(result.result, -1);
  assert(result.steps.some(s => s.event === 'exception'));
});

test('uncaught errors retain the failing state and exact source line', () => {
  const result = run('def search(array):\n    i = 100\n    return array[i]\n');
  assert.equal(result.status, 'error');
  assert.equal(result.line, 3);
  assert.match(result.message, /IndexError/);
  assert(result.steps.some(s => s.event === 'exception' && s.frames[0].locals.i === 100));
});

test('step, byte, elapsed, and depth limits keep a prefix', () => {
  const loop = 'def search(array):\n    i = 0\n    while True:\n        i += 1\n';
  const steps = run(loop, { array: '[]' }, 'search', { max_steps: 20 });
  assert.equal(steps.status, 'limited');
  assert.equal(steps.steps.length, 20);
  const bytes = run(loop, { array: '[]' }, 'search', { max_bytes: 2000 });
  assert.equal(bytes.status, 'limited');
  assert(bytes.steps.length > 0);
  const elapsed = run(loop, { array: '[]' }, 'search', { max_seconds: 0.002, max_steps: 100000 });
  assert.equal(elapsed.status, 'limited');
  const depth = run('def search(array):\n    return search(array)\n');
  assert.equal(depth.status, 'limited');
  assert.match(depth.message, /depth/);
});

test('preserves integral floats as floats, not usable Python indices', () => {
  const result = run('def search(array):\n    i = 2.0\n    return array[i]\n', { array: '[0.0, 1.0, 2.0]' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /TypeError/);
  assert.deepEqual(result.steps.at(-1).frames[0].locals.i, { kind: 'number', text: '2.0' });
  assert.deepEqual(result.steps[0].frames[0].locals.array[0], { kind: 'number', text: '0.0' });
});

test('validates JSON inputs without rounding large Python integers', () => {
  const exact = run('def search(array):\n    return array[0] + 1', { array: '[9007199254740993]' });
  assert.deepEqual(exact.result, { kind: 'number', text: '9007199254740994' });
  for (const array of ['[NaN]', '[Infinity]', '[[1]]', '[true]', '["a"]', 'not json']) {
    assert.equal(run(rotated, { array }).status, 'error', array);
  }
  assert.equal(run('def search(array, other):\n    return 0', { array: '[]', other: '[]' }).status, 'error');
});

test('standard-library imports and deferred typing annotations work', () => {
  const result = run('import math\nfrom typing import List\ndef search(array: List[int]):\n    return math.floor(array[0])', { array: '[1.9]' });
  assert.equal(result.status, 'complete');
  assert.equal(result.result, 1);
  assert.equal(run('def search(array: List[int]) -> int:\n    return len(array)').result, 7);
});

test('unwinding is not mislabeled as a real return, including finally mutations', () => {
  const result = run(`def search(array):
    try:
        raise ValueError("broken")
    finally:
        array.append(9)
`, { array: '[1]' });
  assert.equal(result.status, 'error');
  assert.equal(result.steps.at(-1).event, 'unwind');
  assert.deepEqual(result.steps.at(-1).frames[0].locals.array, [1, 9]);
  const suppressed = run(`def search(array):
    try:
        raise ValueError("handled")
    finally:
        return 5
`);
  assert.equal(suppressed.status, 'complete');
  assert.equal(suppressed.result, 5);
  assert.equal(suppressed.steps.at(-1).event, 'return');
  const implicit = run('def search(array):\n    array.append(1)');
  assert.equal(implicit.result, null);
  assert.equal(implicit.steps.at(-1).event, 'return');
});

test('recording does not re-evaluate side-effecting expressions', () => {
  const result = run('def search(array):\n    if array.pop() > 1:\n        return array\n', { array: '[1, 2, 3]' });
  assert.deepEqual(result.result, [1, 2]);
  assert.deepEqual(result.steps[0].frames[0].locals.array, [1, 2, 3]);
});

test('each offered standard-library module loads in the locked runtime', () => {
  for (const name of ['math', 'bisect', 'heapq', 'collections', 'functools', 'itertools', 'operator', 'statistics', 'typing', 'random']) {
    assert.equal(run(`import ${name}\ndef search(array):\n    return len(array)`).status, 'complete', name);
  }
});

test('array limits stop growing runs without discarding their prefix', () => {
  const result = run('def search(array):\n    array.append(1)\n    return array', { array: JSON.stringify(Array(1000).fill(0)) });
  assert.equal(result.status, 'limited');
  assert.match(result.message, /Array limit/);
  assert(result.steps.length > 0);
  assert.equal(result.steps[0].frames[0].locals.array.length, 1000);
  assert(analyze('def same(array): pass\ndef same(array): pass').error);
});

test('captures stdout and displays non-array containers without custom repr', () => {
  const result = run('def search(array):\n    values = {1: 2}\n    print("hello")\n    return values');
  assert.equal(result.output, 'hello\n');
  assert.deepEqual(result.result, { kind: 'summary', text: '<dict: 1 items>' });
});
