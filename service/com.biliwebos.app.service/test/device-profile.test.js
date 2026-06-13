const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDeviceProfile,
  renderDescriptionXml,
  getSsdpNotifyPackets,
  getSsdpSearchResponse,
} = require('../cast/deviceProfile');

test('description xml exposes AVTransport and NirvanaControl services', () => {
  const profile = createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958, friendlyName: 'B站 webOS' });
  const xml = renderDescriptionXml(profile);

  assert.match(xml, /<friendlyName>B站 webOS<\/friendlyName>/);
  assert.match(xml, /urn:schemas-upnp-org:service:AVTransport:1/);
  assert.match(xml, /urn:app-bilibili-com:service:NirvanaControl:3/);
  assert.match(xml, /<controlURL>AVTransport\/action<\/controlURL>/);
  assert.match(xml, /<controlURL>NirvanaControl\/action<\/controlURL>/);
});

test('default device profile matches official-style bilibili renderer fields', () => {
  const profile = createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958 });
  const xml = renderDescriptionXml(profile);

  assert.match(xml, /<friendlyName>我的小电视<\/friendlyName>/);
  assert.match(xml, /<X_brandName>ATV<\/X_brandName>/);
  assert.match(xml, /<modelDescription>云视听小电视<\/modelDescription>/);
});

test('ssdp packets advertise media renderer and nirvana service', () => {
  const profile = createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958 });

  const packets = getSsdpNotifyPackets(profile);
  const joined = packets.join('\n---\n');

  assert.match(joined, /NTS: ssdp:alive/);
  assert.match(joined, /urn:schemas-upnp-org:device:MediaRenderer:1/);
  assert.match(joined, /urn:app-bilibili-com:service:NirvanaControl:3/);
});

test('ssdp search response points to description xml and echoes the requested ST', () => {
  const profile = createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958 });
  const response = getSsdpSearchResponse(profile, 'urn:schemas-upnp-org:device:MediaRenderer:1');

  assert.match(response, /HTTP\/1\.1 200 OK/);
  assert.match(response, /LOCATION: http:\/\/192\.168\.1\.2:9958\/description\.xml/);
  assert.match(response, /USN: uuid:atvbilibili&[A-F0-9]+::urn:schemas-upnp-org:device:MediaRenderer:1/);
  assert.match(response, /ST: urn:schemas-upnp-org:device:MediaRenderer:1/);
});

test('ssdp search response falls back to rootdevice when ST is empty', () => {
  const profile = createDeviceProfile({ ip: '192.168.1.2', httpPort: 9958 });
  const response = getSsdpSearchResponse(profile, '');

  assert.match(response, /ST: upnp:rootdevice/);
  assert.match(response, /USN: uuid:atvbilibili&[A-F0-9]+::upnp:rootdevice/);
});
