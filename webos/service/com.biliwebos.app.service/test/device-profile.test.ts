import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  createDeviceProfile,
  getSsdpNotifyPackets,
  getSsdpSearchResponse,
  renderAvTransportScpd,
  renderDescriptionXml,
  renderNirvanaScpd,
} from '../src/cast/deviceProfile.ts';

test('description xml exposes AVTransport and NirvanaControl services', () => {
  const profile = createDeviceProfile({
    ip: '192.168.1.2',
    httpPort: 9958,
    friendlyName: 'B站 webOS',
  });
  const xml = renderDescriptionXml(profile);
  assert.match(xml, /<friendlyName>B站 webOS<\/friendlyName>/);
  assert.match(xml, /urn:schemas-upnp-org:service:AVTransport:1/);
  assert.match(xml, /urn:app-bilibili-com:service:NirvanaControl:3/);
});

test('scpd renderers expose expected actions', () => {
  assert.match(renderAvTransportScpd(), /<action><name>Play<\/name><\/action>/);
  assert.match(renderNirvanaScpd(), /GetAppInfo/);
  const packets = getSsdpNotifyPackets(
    createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958 }),
  );
  assert.match(packets.join('\n'), /NTS: ssdp:alive/);
  assert.match(
    getSsdpSearchResponse(
      createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958 }),
      'urn:schemas-upnp-org:device:MediaRenderer:1',
    ),
    /HTTP\/1\.1 200 OK/,
  );
});
