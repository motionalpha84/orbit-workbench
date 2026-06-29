import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOrbitText } from '../js/importers.mjs';

test('parses complete TXT orbit batches with double precision values', () => {
  const records = parseOrbitText(`
Solution 1
213450.4849019597
0.8126850917
63.4000000000
181.2296446016
250.0000000000
12.3456789012

Solution 2
113450.4849019597
0.7126850917
53.4000000000
171.2296446016
240.0000000000
22.3456789012
`);

  assert.equal(records.length, 2);
  assert.equal(records[0].name, 'Solution 1');
  assert.equal(records[0].semiMajorAxisKm, Number('213450.4849019597'));
  assert.equal(records[0].eccentricity, Number('0.8126850917'));
  assert.equal(records[0].inclinationDeg, Number('63.4000000000'));
  assert.equal(records[0].raanDeg, Number('181.2296446016'));
  assert.equal(records[0].argPeriapsisDeg, Number('250.0000000000'));
  assert.equal(records[0].trueAnomalyDeg, Number('12.3456789012'));
});

test('defaults true anomaly to 0 when TXT records match the shorter provided example', () => {
  const records = parseOrbitText(`
Solution 1
213450.4849019597
0.8126850917
63.4000000000
181.2296446016
250.0000000000

Solution 2
113450.4849019597
0.8126850917
63.4000000000
181.2296446016
250.0000000000
`);

  assert.equal(records.length, 2);
  assert.equal(records[0].trueAnomalyDeg, 0);
  assert.equal(records[1].name, 'Solution 2');
  assert.equal(records[1].semiMajorAxisKm, Number('113450.4849019597'));
});

test('reports the source line when a TXT orbit value is invalid', () => {
  assert.throws(
    () => parseOrbitText(`
Broken
not-a-number
0.1
10
20
30
40
`),
    /第 3 行/,
  );
});
