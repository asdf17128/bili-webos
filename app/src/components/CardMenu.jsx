import React, { useEffect, useState } from 'react';
import { getToView, addToView, delToView, getVideoInfo } from '../api/client';
import { storage } from '../utils/storage';
import { t } from '../i18n';

// 卡片长按菜单。任何列表里的卡片长按 OK 都弹它 —— 首页/分区/搜索/收藏/稍后再看,
// 以及播放器底部的相关推荐。
//
// 键盘不走 setCustomKeyHandler:那是个单槽全局变量,播放器已经占着,菜单再抢就得
// 负责还回去,一旦漏还整个播放器就哑了。改成 window 上的**捕获阶段**监听 —— 捕获
// 先于冒泡,天然盖过焦点系统和播放器的处理器,卸载即恢复,不需要任何交接。
//
// 打开方式:VideoCard 的长按默认派发 'card-menu' 事件,App 在根节点接住并渲染本组件
// (浮层挂根节点是 DESIGN.md 第 4 条的要求,免得被父容器 overflow 裁掉)。

// 稍后再看列表的短缓存:菜单要判断"这个视频在不在队列里",而 B站 没有单视频查询
// 接口,只能拉整表(≤100 条)。60 秒内复用,避免连开几次菜单就打几次请求。
let cache = { at: 0, ids: null };
export function invalidateToViewCache() { cache = { at: 0, ids: null }; }

async function toViewIds() {
  if (cache.ids && Date.now() - cache.at < 60000) return cache.ids;
  try {
    const res = await getToView();
    const ids = new Set((res?.data?.list || []).map(v => String(v.aid)));
    cache = { at: Date.now(), ids };
    return ids;
  } catch (e) { return new Set(); }
}

export default function CardMenu({ video, onClose }) {
  const [inList, setInList] = useState(null);   // null = 还在查
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const loggedIn = !!storage.getAuth()?.SESSDATA;

  // aid 必须现查:列表接口只认 aid,而卡片上多数只有 bvid。
  const [aid, setAid] = useState(video?.aid || null);
  useEffect(() => {
    let dead = false;
    (async () => {
      let a = video?.aid;
      if (!a && video?.bvid) {
        try { a = (await getVideoInfo(video.bvid))?.data?.aid; } catch (e) { /* 保持 null */ }
      }
      if (dead) return;
      setAid(a || null);
      if (!loggedIn || !a) { setInList(false); return; }
      const ids = await toViewIds();
      if (!dead) setInList(ids.has(String(a)));
    })();
    return () => { dead = true; };
  }, [video, loggedIn]);

  const items = [];
  if (loggedIn) {
    items.push(inList
      ? { key: 'del', label: t('从稍后再看移除') }
      : { key: 'add', label: inList === null ? t('稍后再看') : t('加入稍后再看') });
  }
  items.push({ key: 'close', label: t('取消') });

  const run = async (key) => {
    if (key === 'close') { onClose(); return; }
    if (!aid || busy) return;
    setBusy(true);
    try {
      const res = key === 'del' ? await delToView(aid) : await addToView(aid);
      if (res?.code === 0) {
        invalidateToViewCache();
        // 列表页要跟着变(移除后那张卡该消失),用事件通知,免得把回调穿过 6 个页面。
        window.dispatchEvent(new CustomEvent('toview-changed', { detail: { aid, added: key === 'add' } }));
        setMsg(key === 'del' ? t('已从稍后再看移除') : t('已加入稍后再看'));
        setTimeout(onClose, 850);
      } else {
        setMsg((res && res.message) || t('操作失败,请重试'));
        setBusy(false);
      }
    } catch (e) { setMsg(t('操作失败,请重试')); setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Backspace', 'GoBack', 'Escape'].includes(k) && e.keyCode !== 461) return;
      e.preventDefault();
      e.stopPropagation();
      if (k === 'ArrowUp') setIdx(i => Math.max(0, i - 1));
      else if (k === 'ArrowDown') setIdx(i => Math.min(items.length - 1, i + 1));
      else if (k === 'Enter') run(items[idx]?.key);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);   // 捕获阶段
    return () => window.removeEventListener('keydown', onKey, true);
  }, [idx, items.length, aid, busy, inList]);

  return (
    <div className="cardmenu-mask" onClick={onClose}>
      <div className="cardmenu" onClick={(e) => e.stopPropagation()}>
        <div className="cardmenu-title">{video?.title || ''}</div>
        {msg
          ? <div className="cardmenu-msg">{msg}</div>
          : items.map((it, i) => (
            <div key={it.key}
              className={`cardmenu-item${i === idx ? ' focused' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(it.key)}>
              {it.label}
            </div>
          ))}
      </div>
    </div>
  );
}
