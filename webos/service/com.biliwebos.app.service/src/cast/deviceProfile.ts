// @ts-nocheck
import crypto from 'node:crypto';

const SERVER_NAME = 'Linux/3.0.0, UPnP/1.0, Platinum/1.0.5.13';

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatHttpDate(date) {
  return new Date(date || Date.now()).toUTCString();
}

function randomUuid() {
  return crypto.randomBytes(18).toString('hex').toUpperCase().slice(0, 35);
}

export function createDeviceProfile(options) {
  options = options || {};
  return {
    uuid: options.uuid || randomUuid(),
    ip: options.ip || '127.0.0.1',
    httpPort: options.httpPort || 9958,
    friendlyName: options.friendlyName || '我的小电视',
    manufacturer: 'Bilibili Inc.',
    manufacturerURL: 'https://www.bilibili.com/',
    modelDescription: '云视听小电视',
    modelName: 'BRAVIA 4K 2015',
    modelNumber: '1024',
    modelURL: 'https://app.bilibili.com/',
    serialNumber: '1024',
    brandName: 'ATV',
    hostVersion: '25',
    ottVersion: '105500',
    channelName: 'master',
    capability: '255',
    serverName: SERVER_NAME,
  };
}

export function getLocation(profile) {
  return `http://${profile.ip}:${profile.httpPort}/description.xml`;
}

export function renderDescriptionXml(profile) {
  return [
    '<root xmlns:dlna="urn:schemas-dlna-org:device-1-0" xmlns="urn:schemas-upnp-org:device-1-0">',
    '<specVersion><major>1</major><minor>0</minor></specVersion>',
    '<device>',
    '<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>',
    `<UDN>uuid:${xmlEscape(profile.uuid)}</UDN>`,
    `<friendlyName>${xmlEscape(profile.friendlyName)}</friendlyName>`,
    `<manufacturer>${xmlEscape(profile.manufacturer)}</manufacturer>`,
    `<manufacturerURL>${xmlEscape(profile.manufacturerURL)}</manufacturerURL>`,
    `<modelDescription>${xmlEscape(profile.modelDescription)}</modelDescription>`,
    `<modelName>${xmlEscape(profile.modelName)}</modelName>`,
    `<modelNumber>${xmlEscape(profile.modelNumber)}</modelNumber>`,
    `<modelURL>${xmlEscape(profile.modelURL)}</modelURL>`,
    `<serialNumber>${xmlEscape(profile.serialNumber)}</serialNumber>`,
    `<X_brandName>${xmlEscape(profile.brandName)}</X_brandName>`,
    `<hostVersion>${xmlEscape(profile.hostVersion)}</hostVersion>`,
    `<ottVersion>${xmlEscape(profile.ottVersion)}</ottVersion>`,
    `<channelName>${xmlEscape(profile.channelName)}</channelName>`,
    `<capability>${xmlEscape(profile.capability)}</capability>`,
    '<dlna:X_DLNADOC xmlns:dlna="urn:schemas-dlna-org:device-1-0">DMR-1.50</dlna:X_DLNADOC>',
    '<dlna:X_DLNACAP xmlns:dlna="urn:schemas-dlna-org:device-1-0">playcontainer-1-0</dlna:X_DLNACAP>',
    '<serviceList>',
    '<service>',
    '<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>',
    '<serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>',
    '<controlURL>AVTransport/action</controlURL>',
    '<eventSubURL>AVTransport/event</eventSubURL>',
    '<SCPDURL>dlna/AVTransport.xml</SCPDURL>',
    '</service>',
    '<service>',
    '<serviceType>urn:app-bilibili-com:service:NirvanaControl:3</serviceType>',
    '<serviceId>urn:app-bilibili-com:serviceId:NirvanaControl</serviceId>',
    '<controlURL>NirvanaControl/action</controlURL>',
    '<eventSubURL>NirvanaControl/event</eventSubURL>',
    '<SCPDURL>dlna/NirvanaControl.xml</SCPDURL>',
    '</service>',
    '</serviceList>',
    '</device>',
    '</root>',
  ].join('');
}

export function renderAvTransportScpd() {
  return [
    '<?xml version="1.0"?>',
    '<scpd xmlns="urn:schemas-upnp-org:service-1-0">',
    '<specVersion><major>1</major><minor>0</minor></specVersion>',
    '<actionList>',
    '<action><name>Play</name></action>',
    '<action><name>Pause</name></action>',
    '<action><name>Stop</name></action>',
    '<action><name>Seek</name></action>',
    '</actionList>',
    '</scpd>',
  ].join('');
}

export function renderNirvanaScpd() {
  return '<actionList><action><name>GetAppInfo</name><argumentList></argumentList></action></actionList>';
}

function buildNotify(profile, nt, usn) {
  return [
    'NOTIFY * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    `LOCATION: ${getLocation(profile)}`,
    'CACHE-CONTROL: max-age=30',
    `SERVER: ${profile.serverName}`,
    'NTS: ssdp:alive',
    `USN: ${usn}`,
    `NT: ${nt}`,
    '',
    '',
  ].join('\r\n');
}

export function getSsdpNotifyPackets(profile) {
  const uuid = `uuid:${profile.uuid}`;
  return [
    buildNotify(profile, 'upnp:rootdevice', `${uuid}::upnp:rootdevice`),
    buildNotify(
      profile,
      'urn:schemas-upnp-org:device:MediaRenderer:1',
      `${uuid}::urn:schemas-upnp-org:device:MediaRenderer:1`,
    ),
    buildNotify(
      profile,
      'urn:schemas-upnp-org:service:AVTransport:1',
      `${uuid}::urn:schemas-upnp-org:service:AVTransport:1`,
    ),
    buildNotify(
      profile,
      'urn:app-bilibili-com:service:NirvanaControl:3',
      `${uuid}::urn:app-bilibili-com:service:NirvanaControl:3`,
    ),
  ];
}

export function getSsdpSearchResponse(profile, _st) {
  return [
    'HTTP/1.1 200 OK',
    `LOCATION: ${getLocation(profile)}`,
    'CACHE-CONTROL: max-age=30',
    `SERVER: ${profile.serverName}`,
    'EXT:',
    'BOOTID.UPNP.ORG: 1669443520',
    'CONFIGID.UPNP.ORG: 10177363',
    `USN: uuid:atvbilibili&${profile.uuid}::upnp:rootdevice`,
    'ST: upnp:rootdevice',
    `DATE: ${formatHttpDate()}`,
    '',
    '',
  ].join('\r\n');
}
