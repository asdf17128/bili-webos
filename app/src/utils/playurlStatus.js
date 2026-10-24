// Safe structured diagnostics: never include voucher values or signed URLs.
export function playurlData(response) { return response?.data || response?.result || {}; }
export function hasPlayurlStream(response) {
  const d = playurlData(response);
  return response?.code === 0 && !!(d.dash?.video?.length || d.durl?.length);
}
export function playurlErrorCode(response) {
  if (response?.code === 0 && playurlData(response).v_voucher && !hasPlayurlStream(response)) return -352;
  return response?.code;
}
export function playurlSummary(response) {
  return `code=${typeof response?.code === 'number' ? response.code : 'unknown'} voucher=${playurlData(response).v_voucher ? 1 : 0} stream=${hasPlayurlStream(response) ? 1 : 0}`;
}
