import test from 'node:test';
import assert from 'node:assert/strict';
import { WireRecordCache } from '../js/wire-records.mjs';
test('stable wire datasets reuse requests but invalidate every authoritative input change', () => {
  const cache = new WireRecordCache();
  const record = {id:'a',name:'A',color:'#88ccaa',visible:true,orbit:{elements:{semiMajorAxisKm:7000,eccentricity:.001,inclinationDeg:51.6,raanDeg:40,argPeriapsisDeg:30,trueAnomalyDeg:0}}};
  let current = cache.get([record]);
  assert.equal(cache.get([record]), current);
  record.reference = [{ positionKm:{x:1,y:2,z:3} }];
  assert.equal(cache.get([record]), current, 'display samples do not invalidate the dataset');
  for (const mutate of [()=>record.visible=false,()=>record.name='B',()=>record.color='#ffffff',()=>record.orbit.elements.raanDeg=85]) {
    const previous = current; mutate(); current=cache.get([record]); assert.notEqual(current, previous); assert.notEqual(current[0], previous[0]);
  }
  assert.equal(current[0].elements.raanDeg,85);
  assert.deepEqual(cache.get([]),[]);
  assert.equal(cache.entries.size,0);
});
