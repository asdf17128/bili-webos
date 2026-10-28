import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaKeyAction } from './mediaKeys.js';
test('LG codes and DOM media names agree without capturing navigation keys',()=>{
 for(const [key,keyCode,action] of [['MediaPlay',415,'play'],['MediaPause',19,'pause'],['MediaPlayPause',179,'toggle']]){
  assert.equal(mediaKeyAction({key}),action);assert.equal(mediaKeyAction({key:'Unidentified',keyCode}),action);
 }
 for(const key of ['Enter','ArrowDown','Escape','MediaStop',' '])assert.equal(mediaKeyAction({key}),null);
});
