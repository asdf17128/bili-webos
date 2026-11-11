import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressReporter } from './progressReporter.js';
const drain = () => new Promise(resolve => setImmediate(resolve));
test('cast progress deduplicates seconds and preserves backwards seeks', async () => {
  const sent=[];const r=createProgressReporter(p=>sent.push(p));
  r.update(600,10.1);await drain();r.update(600,10.9);await drain();
  assert.equal(sent.length,1);r.update(600,11);await drain();r.update(600,3);await drain();
  assert.deepEqual(sent.map(p=>p.position),[10,11,3]);
});
test('slow cast service keeps only newest progress and stops after disposal', async () => {
  const sent=[],resolve=[];const r=createProgressReporter(p=>{sent.push(p);return new Promise(r=>resolve.push(r));});
  r.update(600,1);await drain();for(let i=2;i<=100;i++)r.update(600,i);
  assert.equal(sent.length,1);resolve.shift()();await drain();assert.deepEqual(sent.map(p=>p.position),[1,100]);
  r.update(600,101);r.dispose();resolve.shift()();await drain();assert.equal(sent.length,2);
});
test('cast errors retry on a later sample without an immediate retry loop',async()=>{
  let calls=0;const r=createProgressReporter(()=>{calls++;return Promise.reject(Error('offline'));});
  r.update(600,1);await drain();assert.equal(calls,1);r.update(600,1);await drain();assert.equal(calls,2);r.dispose();
});
