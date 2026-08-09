// 三连之后「点赞/投币/收藏」三个按钮的点亮状态,单独抽出来做纯函数 —— 因为它错过一次:
// owner 2026-08-09:「一键三连之后,只有收藏的数字的颜色变了,另外两个怎么不变呢」。
//
// 根因是语义搞反了。三连接口返回的 data.{like,coin,fav} 是**这次调用做了什么**,
// 不是**最终是什么状态**:如果这个视频之前已经点过赞、投过币,返回的就是
// {like:false, coin:false, fav:true} —— 只有收藏是这次新增的。老代码写成
//   liked: p.liked || !!d.like
// 于是在本地 rel 没加载到(首次 relation 请求失败)的情况下,赞和币永远点不亮,
// 只有收藏亮 —— 正好是 owner 看到的现象。
//
// 正确语义:**三连返回 code=0,就意味着三项最终都成立**(不管是这次做的还是之前做的)。

// 三连成功后的最终状态。prev 只用于保留已有的投币数(B站 上限 2)。
export function tripleNextRel(prev, data) {
  const d = data || {};
  const coinsNow = d.coin ? (d.multiply || 2) : 0;
  return {
    liked: true,
    coined: Math.min(2, Math.max(prev?.coined || 0, coinsNow, 1)),
    faved: true,
  };
}

// 三连后的计数增量:只有**这次真的做了**的那几项才 +1(已经赞过的不能再 +1,
// 否则数字会比服务端多)。
export function tripleNextStat(prevStat, prevRel, data) {
  const d = data || {};
  const coinsNow = d.coin ? (d.multiply || 2) : 0;
  return {
    like: (prevStat?.like || 0) + (prevRel?.liked ? 0 : (d.like ? 1 : 0)),
    coin: (prevStat?.coin || 0) + coinsNow,
    favorite: (prevStat?.favorite || 0) + (prevRel?.faved ? 0 : (d.fav ? 1 : 0)),
  };
}

// 服务端校准(/x/web-interface/archive/relation)只允许**往上合并**,不允许把
// 刚写成功的状态改回去。字段名以实测为准:{attention, favorite, season_fav,
// like, dislike, coin}(2026-08-09 实测,coin 是枚数不是布尔)。
export function mergeServerRel(prev, rd) {
  if (!rd) return prev;
  return {
    liked: !!(prev?.liked || rd.like || rd.attitude > 0),
    coined: Math.max(prev?.coined || 0, rd.coin || 0),
    faved: !!(prev?.faved || rd.favorite),
  };
}
