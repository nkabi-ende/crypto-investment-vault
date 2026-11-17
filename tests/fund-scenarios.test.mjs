import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateFundScenario} from '../public/fund-scenarios.js';

test('fund illustrations compound daily and scale proportionately across both accounts', () => {
  const small = calculateFundScenario(100, 1, 7), large = calculateFundScenario(200, 1, 7);
  assert.equal(small.values.length, 8);
  assert.equal(small.values[0].balance, 100);
  assert.ok(Math.abs(small.values[7].balance - 107.213535210701) < 1e-9);
  assert.ok(Math.abs(small.values[7].daily - 1.061520150601) < 1e-9);
  assert.equal(small.values[7].balance.toFixed(2), '107.21');
  assert.equal(large.values[7].balance.toFixed(2), '214.43');
  assert.equal(small.change, large.change);
  for (let day = 0; day <= 7; day++) {
    assert.equal(large.values[day].profit, small.values[day].profit * 2);
    assert.equal(large.values[day].daily, small.values[day].daily * 2);
  }
});

test('flat, negative and total-loss scenarios keep daily values and percentage change consistent', () => {
  const flat = calculateFundScenario(100, 0, 30);
  assert.equal(flat.change, 0); assert.ok(flat.values.every(point => point.balance === 100 && point.daily === 0));
  const loss = calculateFundScenario(100, -10, 2);
  assert.equal(loss.values[2].balance, 81); assert.equal(loss.values[2].daily, -9);
  assert.ok(Math.abs(loss.change + 19) < 1e-10);
  const total = calculateFundScenario(200, -100, 90);
  assert.equal(total.change, -100); assert.equal(total.values[1].daily, -200);
  assert.ok(total.values.slice(2).every(point => point.balance === 0 && point.daily === 0));
});

test('calculator bounds reject invalid inputs and remain finite at the highest supported scenario', () => {
  for (const args of [[0, 1, 7], [100, NaN, 7], [100, 101, 7], [100, -101, 7], [200, 1, 0], [200, 1, 91], [100, 1, 1.5]]) {
    assert.throws(() => calculateFundScenario(...args), RangeError);
  }
  const maximum = calculateFundScenario(200, 100, 90);
  assert.ok(maximum.values.every(point => Number.isFinite(point.balance) && Number.isFinite(point.daily)));
  assert.equal(maximum.values[90].balance, 200 * 2 ** 90);
});
