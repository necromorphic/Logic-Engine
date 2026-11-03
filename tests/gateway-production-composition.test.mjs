import test from 'node:test';
import assert from 'node:assert/strict';
import { info, init, exit } from '../index.mjs';

test('production SillyTavern plugin module graph loads with embedded Gateway dependencies', () => {
  assert.equal(info.id, 'logic-engine');
  assert.equal(typeof init, 'function');
  assert.equal(typeof exit, 'function');
});
