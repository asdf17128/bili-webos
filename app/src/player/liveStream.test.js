import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLivePlayback } from './liveStream.js';
const response = () => ({code:0,data:{playurl_info:{playurl:{
  g_qn_desc:[{qn:10000,desc:'原画'},{qn:250,desc:'超清'}],
  stream:[{format:['flv','ts','fmp4'].map(format_name=>({format_name,codec:[{codec_name:'avc',current_qn:10000,accept_qn:[250,10000],base_url:`/${format_name}.m3u8`,url_info:[{host:'https://live.bilivideo.com',extra:'?signed=fixture'}]}]}))}],
}}}});
test('TS-first API ordering still selects fMP4 with matching original-quality metadata',()=>{
 const r=selectLivePlayback(response());
 assert.equal(r.format,'fmp4');assert.equal(r.qn,10000);
 assert.deepEqual(r.accept,[{qn:10000,label:'原画'},{qn:250,label:'超清'}]);
 assert.equal(r.url,'https://live.bilivideo.com/fmp4.m3u8?signed=fixture');
});
test('explicit fallback selects TS without reducing quality',()=>{
 const r=selectLivePlayback(response(),'ts');assert.equal(r.format,'ts');assert.equal(r.qn,10000);
});
test('rooms missing usable fMP4 AVC keep working through TS',()=>{
 const r=response();r.data.playurl_info.playurl.stream[0].format[2].codec[0].codec_name='hevc';
 assert.equal(selectLivePlayback(r).format,'ts');
});
test('FLV-only and missing HLS URL responses are errors rather than endless loading',()=>{
 const r=response();r.data.playurl_info.playurl.stream[0].format.length=1;
 assert.throws(()=>selectLivePlayback(r),/No playable/);
 assert.throws(()=>selectLivePlayback({code:0,data:{}}),/No playable/);
});
test('failed API response is not mistaken for an empty room',()=>{
 assert.throws(()=>selectLivePlayback({code:-352}),/Live API: -352/);
});
test('failed live CDN uses the exact signed backup at identical format and quality',()=>{
 const r=response();r.data.playurl_info.playurl.stream[0].format[2].codec[0].url_info.push({host:'https://backup.bilivideo.com',extra:'?signed=second&token=fixture'});
 const selected=selectLivePlayback(r,'fmp4',['live.bilivideo.com']);
 assert.equal(selected.url,'https://backup.bilivideo.com/fmp4.m3u8?signed=second&token=fixture');
 assert.equal(selected.qn,10000);assert.equal(selected.format,'fmp4');
});
test('all recently failed nodes still allow bounded recovery with fresh API source',()=>{
 const selected=selectLivePlayback(response(),'fmp4',['live.bilivideo.com']);
 assert.equal(selected.url,'https://live.bilivideo.com/fmp4.m3u8?signed=fixture');
});
test('network preference never chooses another codec or container',()=>{
 const selected=selectLivePlayback(response(),'ts',['live.bilivideo.com']);
 assert.equal(selected.format,'ts');assert.equal(selected.qn,10000);
});
test('all failed CDN candidates rotate to the least recently failed host',()=>{
 const r=response();r.data.playurl_info.playurl.stream[0].format[2].codec[0].url_info.push({host:'https://backup.bilivideo.com',extra:'?signed=second'});
 const selected=selectLivePlayback(r,'fmp4',['backup.bilivideo.com','live.bilivideo.com']);
 assert.equal(selected.url,'https://backup.bilivideo.com/fmp4.m3u8?signed=second');
});
test('malformed hosts never become the recovery fallback',()=>{
 const r=response();r.data.playurl_info.playurl.stream[0].format[2].codec[0].url_info.unshift({host:'https://['});
 const selected=selectLivePlayback(r,'fmp4',['live.bilivideo.com']);
 assert.equal(selected.url,'https://live.bilivideo.com/fmp4.m3u8?signed=fixture');
});
