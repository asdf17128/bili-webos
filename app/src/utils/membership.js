// Read fresh nav data, never infer membership from cookies or content badges.
export function membership(data, now = Date.now()) {
  if (!data?.isLogin) return null;
  const vip = data.vip || {};
  const status = Number(vip.status ?? data.vipStatus);
  const type = Number(vip.type ?? data.vipType);
  const due = Number(vip.due_date ?? data.vipDueDate);
  if (status !== 1 || ![1, 2].includes(type) || (due > 0 && due <= now)) return null;
  return type === 2 ? 'annual' : 'active';
}
