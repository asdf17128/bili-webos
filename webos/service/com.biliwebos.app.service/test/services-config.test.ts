import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

test('services.json declares the public Luna commands used by the app', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, '..', 'services.json'), 'utf8'),
  );

  const service = config.services.find(
    (item) => item.name === 'com.biliwebos.app.service',
  );

  expect(service?.commands?.map((command) => command.name)).toEqual(
    expect.arrayContaining([
      'fetch',
      'getCookies',
      'setCookies',
      'clearCookies',
      'ping',
      'castSubscribe',
      'castAck',
      'castReportState',
      'castReportProgress',
      'castGetStatus',
      'castSetConfig',
    ]),
  );
});
