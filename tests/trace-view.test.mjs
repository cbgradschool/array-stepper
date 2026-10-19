import { test } from 'node:test';
import assert from 'node:assert/strict';
import { display, changed, arrays, defaultArray, indexValue, previousFrame } from '../src/lib/trace-view.ts';

test('display preserves Python values and exact integer strings', () => {
  assert.equal(display(null), 'None');
  assert.equal(display(false), 'False');
  assert.equal(display({ kind: 'number', text: '9007199254740993' }), '9007199254740993');
  assert.equal(display([1, 2.5]), '[1, 2.5]');
});
test('array selection prefers the active function parameter', () => {
  const frame = { id: 1, parameters: ['array'], locals: { result: [], array: [3, 2, 1], i: 1 } };
  assert.equal(defaultArray(frame), 'array');
  assert.equal(arrays(frame).length, 2);
});
test('only integer numeric values can become pointer positions', () => {
  assert.equal(indexValue(-1), -1);
  assert.equal(indexValue(100), 100);
  assert.equal(indexValue(2.5), null);
  assert.equal(indexValue(true), null);
  assert.equal(indexValue(undefined), null);
  assert.equal(indexValue({ kind: 'number', text: '100000000000000000000' }), '100000000000000000000');
  assert.equal(indexValue({ kind: 'number', text: 'inf' }), null);
  assert.equal(indexValue({ kind: 'number', text: '2.0' }), null);
});
test('change comparisons do not mix recursive frames or undefined state', () => {
  assert.equal(changed(3, undefined), false);
  assert.equal(changed([3, 1], [1, 3]), true);
  const steps = [{ frames: [{ id: 1, locals: { i: 0 } }] }, { frames: [{ id: 2, locals: { i: 5 } }] }];
  assert.equal(previousFrame(steps, 1, { id: 2 }), undefined);
});
