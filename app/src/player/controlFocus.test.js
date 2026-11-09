import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlFocus } from './controlFocus.js';

test('rapid functional focus moves use the latest index without waiting for parent rendering', () => {
  const focus=createControlFocus(5), seen=[];
  const stop=focus.subscribe(()=>seen.push(focus.getSnapshot()));
  for(let i=0;i<20;i++) focus.set(previous=>(previous+1)%9);
  assert.equal(focus.getSnapshot(),7);
  assert.equal(seen.length,20);
  assert.deepEqual(seen.slice(0,4),[6,7,8,0]);
  stop();focus.set(3);assert.equal(seen.length,20);
});

test('same focus is silent; independent players and subscribers stay isolated', () => {
  const first=createControlFocus(5), second=createControlFocus(5);
  let a=0,b=0;
  const stop=first.subscribe(()=>a++);first.subscribe(()=>b++);
  first.set(5);assert.equal(a,0);assert.equal(b,0);
  first.set(1);assert.equal(a,1);assert.equal(b,1);assert.equal(second.getSnapshot(),5);
  stop();first.set(2);assert.equal(a,1);assert.equal(b,2);
});
