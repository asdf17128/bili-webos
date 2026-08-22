// 直播解码失败时的降档策略。抽成纯函数是因为这条路**没法按需制造**:
// 要复现得正好碰上一个"这台电视解不了的档位",而房间随时在变。
// 2026-08-22 owner 报「直播黑屏」,现场抓到的就是这个死循环:
//   connect → media-error{code:3} → retry(同一 qn) → media-error{code:3} → …
// 根因:variant 阶梯只对投屏的 directUrl 生效,B站 房间**完全没有降档**。

// code 3 = MEDIA_ERR_DECODE:这台电视吃不下当前档位的规格。
export const MEDIA_ERR_DECODE = 3;

// 该不该降档:只有 B站 房间(非投屏)遇到解码错误才降。
// 其它错误码(网络 2 / 格式 4)交给原有的重试逻辑,降档解决不了那些。
export function shouldStepDown({ isCast, errorCode }) {
  return !isCast && errorCode === MEDIA_ERR_DECODE;
}

// 下一档:阶梯是从高到低的 qn 数组。已经在最低档就返回 null(别再退,
// 让重试逻辑照常跑,免得把"网络抖动"退成最差画质还回不去)。
export function nextQn(ladder, current) {
  if (!Array.isArray(ladder) || ladder.length === 0) return null;
  const i = ladder.indexOf(current);
  if (i < 0) return ladder[0] === current ? null : ladder[0];  // 当前档不在表里:从最高档重来
  return i + 1 < ladder.length ? ladder[i + 1] : null;
}
