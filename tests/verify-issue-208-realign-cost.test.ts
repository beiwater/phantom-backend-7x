import assert from 'node:assert/strict';
import { realignCost } from '../server/game/simboost-settings.ts';

assert.equal(realignCost(5, -5, 1), 100, 'Moving sales from -5 to -6 costs 100 SimBoosts');
assert.equal(realignCost(-5, 5, -1), 100, 'Moving production from -5 to -6 costs 100 SimBoosts');
assert.equal(realignCost(-5, 5, 1), 75, 'Moving sales from 5 to 4 costs 75 SimBoosts');
assert.equal(realignCost(5, -5, -1), 75, 'Moving production from 5 to 4 costs 75 SimBoosts');

console.log('Issue #208 realignment cost regressions passed');
