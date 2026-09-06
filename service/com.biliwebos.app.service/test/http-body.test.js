const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const zlib = require('node:zlib');
const readBody = require('../httpBody');

for (const encoding of ['identity', 'gzip', 'deflate', 'raw-deflate']) {
  test('complete API response: ' + encoding, async () => {
    const response = new PassThrough();
    response.headers = { 'content-encoding': encoding === 'raw-deflate' ? 'deflate' : encoding };
    const input = Buffer.from('{"code":0,"data":"测试"}');
    const data = encoding === 'gzip' ? zlib.gzipSync(input) : encoding === 'deflate' ? zlib.deflateSync(input) : encoding === 'raw-deflate' ? zlib.deflateRawSync(input) : input;
    const result = new Promise((resolve, reject) => readBody(response, (err, body) => err ? reject(err) : resolve(body)));
    response.end(data);
    assert.deepEqual(await result, input);
  });
}
for (const failure of ['error', 'aborted', 'close']) {
  test('partial API response settles exactly once on ' + failure, async () => {
    const response = new PassThrough(); response.headers = {};
    const calls = [];
    readBody(response, (err, body) => calls.push({ err, body }));
    response.write('{"code":');
    response.emit(failure, new Error('connection reset'));
    response.emit('error', new Error('late socket error'));
    response.end('0}');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1); assert.ok(calls[0].err);
    assert.equal(calls[0].body, undefined);
  });
}
test('invalid compressed API response rejects', async () => {
  const response = new PassThrough(); response.headers = { 'content-encoding': 'gzip' };
  const result = new Promise(resolve => readBody(response, err => resolve(err)));
  response.end('not gzip'); assert.ok(await result);
});
