import React, { useEffect, useRef, useState } from 'react';
import { getToView, addToView, delToView, getVideoInfo, sendRecommendationFeedback } from '../api/client';
import { storage } from '../utils/storage';
import { t } from '../i18n';
import { useUpFollow } from '../hooks/useUpFollow';
import { claimRemoteFocus } from '../hooks/useFocus';
import { recommendationFeedbackContext } from '../utils/recommendationFeedback';
import { recommendationKey, hideRecommendation, restoreRecommendation, lastHiddenRecommendation } from '../utils/hiddenRecommendations';
import { recommendationAuthorKey, recommendationAccountScope, hideRecommendationAuthor, restoreRecommendationAuthor, lastHiddenRecommendationAuthor } from '../utils/hiddenRecommendationAuthors';

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

export default function CardMenu({ video, recommendation = false, onClose }) {
  const [inList, setInList] = useState(null);   // null = 还在查
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const loggedIn = !!storage.getAuth()?.SESSDATA;
  const [feedbackStage, setFeedbackStage] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackKind, setFeedbackKind] = useState('video');
  const [localRevision, setLocalRevision] = useState(0);
  const feedbackLock = useRef(false), mounted = useRef(true);
  const menuIdentity = useRef({ generation: storage.getAuthGeneration(), account: storage.getAuth()?.SESSDATA,
    user: storage.getAuth()?.DedeUserID, scope: recommendationAccountScope(storage.getAuth()) });
  const sameMenuAccount = () => menuIdentity.current.generation === storage.getAuthGeneration()
    && menuIdentity.current.account === storage.getAuth()?.SESSDATA
    && menuIdentity.current.user === storage.getAuth()?.DedeUserID;
  useEffect(() => () => { mounted.current = false; }, []);
  const hideKey = recommendation ? recommendationKey(video) : null;
  const authorKey = recommendation ? recommendationAuthorKey(video) : null;
  const authorScope = menuIdentity.current.scope;
  const isAuthor = feedbackKind === 'author';
  const canHideFeedback = !!(hideKey && (!isAuthor || (authorKey && authorScope)) && sameMenuAccount());
  const canSendFeedback = !!(hideKey && recommendationFeedbackContext(video) && loggedIn && storage.getAuth()?.bili_jct && sameMenuAccount());
  const remoteContext = useRef(null);
  const setFeedback = (stage, message = '') => {
    if (!mounted.current) return;
    setFeedbackStage(stage); setFeedbackMessage(message); setIdx(0);
  };

  const hideLocally = (remote = false, kind = feedbackKind) => {
    if (!sameMenuAccount()) { setFeedback('unavailable', t('账号已变化，请重新打开菜单。')); return null; }
    const author = kind === 'author';
    const result = author ? hideRecommendationAuthor(video, authorScope) : hideRecommendation(video);
    if (!result.key || (author && !result.supported)) {
      setFeedback('unavailable', t('缺少可靠的 UP 或账号标识，无法隐藏该 UP。')); return null;
    }
    setFeedback(remote ? 'submitted' : 'hidden', result.persistent
      ? (author ? (remote ? t('已提交 UP 推荐反馈，并在本机隐藏该 UP') : t('已在本机隐藏该 UP 的推荐'))
        : (remote ? t('已提交不感兴趣，并在本机隐藏') : t('已在本机隐藏')))
      : (remote ? t('已提交反馈；本次隐藏未能保存') : t('已在本次使用中隐藏，但未能保存')));
    return result;
  };
  const restoreLocal = (key, kind = feedbackKind) => {
    if (!key) return;
    if (!sameMenuAccount()) { setFeedback('unavailable', t('账号已变化，请重新打开菜单。')); return; }
    const result = kind === 'author' ? restoreRecommendationAuthor(key, authorScope) : restoreRecommendation(key);
    setLocalRevision(value => value + 1);
    setFeedback('restored', result.persistent ? t('已取消本机隐藏') : t('已恢复本次显示，但未能保存'));
  };
  const sendFeedback = async (cancel = false) => {
    if (feedbackLock.current) return;
    if (!sameMenuAccount()) { setFeedback(cancel ? 'undo-unknown' : 'unknown', t('账号已变化，请重新打开菜单。')); return; }
    feedbackLock.current = true;
    const generation = storage.getAuthGeneration(), account = storage.getAuth()?.SESSDATA, user = storage.getAuth()?.DedeUserID;
    // Keep exactly the submitted recommendation context for an explicit undo.
    const previous = remoteContext.current;
    if (cancel && !previous) { feedbackLock.current = false; return; }
    const kind = cancel ? previous.kind : feedbackKind;
    if (kind === 'author' && (!authorKey || !authorScope)) {
      feedbackLock.current = false; setFeedback('unavailable', t('缺少可靠的 UP 或账号标识，无法隐藏该 UP。')); return;
    }
    const target = cancel ? previous.video : video;
    const reason = cancel ? previous.reason : kind === 'author' ? 4 : 1;
    setFeedback(cancel ? 'undoing' : 'submitting', cancel ? t('正在撤销反馈…') : t('正在提交反馈…'));
    try {
      const result = await sendRecommendationFeedback(target, cancel, reason);
      if (storage.getAuthGeneration() !== generation || storage.getAuth()?.SESSDATA !== account || storage.getAuth()?.DedeUserID !== user) {
        setFeedback('unknown', t('账号已变化，请重新打开菜单。')); return;
      }
      if (result?.code !== 0) {
        setFeedback(cancel ? 'undo-error' : 'error', cancel
          ? (kind === 'author' ? t('撤销未成功，该 UP 的本机隐藏保持不变。') : t('撤销未成功，视频仍在本机隐藏。')) : t('反馈未成功，卡片已保留。'));
        return;
      }
      if (cancel) {
        const restored = kind === 'author' ? restoreRecommendationAuthor(previous.key, previous.scope) : restoreRecommendation(hideKey);
        remoteContext.current = null;
        setFeedback('undone', restored.persistent ? t('已撤销反馈并恢复本机显示') : t('已撤销反馈；本次恢复未能保存'));
      } else {
        remoteContext.current = { video, reason, kind, key: kind === 'author' ? authorKey : hideKey, scope: authorScope };
        hideLocally(true, kind);
      }
    } catch (error) {
      // A lost/late response cannot prove that the server rejected a write.
      // Keep the card and require another explicit action; never auto-retry.
      const changed = storage.getAuthGeneration() !== generation || storage.getAuth()?.SESSDATA !== account || storage.getAuth()?.DedeUserID !== user;
      const notSent = ['FEEDBACK_PREPARATION_FAILED', 'FEEDBACK_CONTEXT_INVALID', 'FEEDBACK_AUTH_REQUIRED', 'FEEDBACK_BUSY', 'FEEDBACK_REASON_INVALID'].includes(error?.code);
      if (!changed && notSent) {
        setFeedback(cancel ? 'undo-error' : 'error', cancel
          ? (kind === 'author' ? t('撤销请求未发送，该 UP 的本机隐藏保持不变。') : t('撤销请求未发送，视频仍在本机隐藏。')) : t('反馈未发送，卡片已保留。'));
        return;
      }
      setFeedback(cancel ? 'undo-unknown' : 'unknown', changed ? t('账号已变化，请重新打开菜单。') : cancel
        ? (kind === 'author' ? t('撤销结果未知，该 UP 的本机隐藏保持不变。') : t('撤销结果未知，视频仍在本机隐藏。')) : t('反馈结果未知，卡片已保留；不会自动重发。'));
    } finally { feedbackLock.current = false; }
  };

  // aid 必须现查:列表接口只认 aid,而卡片上多数只有 bvid。
  const [aid, setAid] = useState(video?.aid || null);
  const [mid, setMid] = useState(video?.owner?.mid || null);
  const follow = useUpFollow(mid);
  useEffect(() => {
    let dead = false;
    (async () => {
      let a = video?.aid;
      if ((!a || !video?.owner?.mid) && video?.bvid) {
        try {
          const d = (await getVideoInfo(video.bvid))?.data;
          a = a || d?.aid;
          if (!dead) setMid(d?.owner?.mid || video?.owner?.mid || null);
        } catch (e) { /* 保持 null */ }
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
  if (feedbackStage) {
    if (feedbackStage === 'confirm') {
      items.push({ key: 'feedback-back', label: t('返回') });
      if (canHideFeedback) items.push({ key: canSendFeedback ? 'feedback-send' : 'hide-local', label: canSendFeedback
        ? (isAuthor ? t('确认对 UP 不感兴趣') : t('确认不感兴趣'))
        : (isAuthor ? t('在本机隐藏此 UP') : t('在本机隐藏')) });
    } else if (feedbackStage === 'submitting' || feedbackStage === 'undoing') {
      items.push({ key: 'wait', label: t('处理中…') });
      items.push({ key: 'close', label: t('关闭菜单') });
    } else if (feedbackStage === 'submitted' || feedbackStage === 'undo-error' || feedbackStage === 'undo-unknown') {
      if (remoteContext.current) items.push({ key: 'feedback-undo', label: t('尝试撤销反馈') });
      items.push({ key: 'restore-local', label: isAuthor ? t('恢复此 UP 的本机显示') : t('恢复本机显示') });
      items.push({ key: 'close', label: t('完成') });
    } else if (feedbackStage === 'hidden') {
      items.push({ key: 'restore-local', label: isAuthor ? t('恢复此 UP 的本机显示') : t('恢复本机显示') });
      items.push({ key: 'close', label: t('完成') });
    } else if (feedbackStage === 'restored' || feedbackStage === 'undone') {
      items.push({ key: 'close', label: t('完成') });
    } else if (feedbackStage === 'unavailable') {
      items.push({ key: 'feedback-back', label: t('返回') });
    } else {
      if (feedbackStage === 'error') items.push({ key: 'feedback-send', label: t('重试提交') });
      if (canHideFeedback) items.push({ key: 'hide-local', label: isAuthor ? t('仅在本机隐藏此 UP') : t('仅在本机隐藏') });
      items.push({ key: 'feedback-back', label: t('返回') });
    }
  } else {
  if (loggedIn) {
    items.push(inList
      ? { key: 'del', label: t('从稍后再看移除') }
      : { key: 'add', label: inList === null ? t('稍后再看') : t('加入稍后再看') });
  }
  if (follow.available) items.push({ key: 'follow', label: follow.label });
  if (hideKey) {
    items.push({ key: 'feedback-video', label: t('不感兴趣：当前视频') });
    items.push({ key: 'feedback-author', label: t('不感兴趣：UP') });
  }
  if (recommendation && lastHiddenRecommendation()) items.push({ key: 'restore-last', label: t('恢复上次本机隐藏') });
  if (recommendation && authorScope && lastHiddenRecommendationAuthor(authorScope)) items.push({ key: 'restore-last-author', label: t('恢复上次本机隐藏的 UP') });
  items.push({ key: 'close', label: t('取消') });
  }

  const run = async (key) => {
    if (key === 'close') { onClose(); return; }
    if (feedbackLock.current) return;
    if (key === 'feedback-video' || key === 'feedback-author') {
      const author = key === 'feedback-author';
      setFeedbackKind(author ? 'author' : 'video');
      if (!sameMenuAccount()) setFeedback('unavailable', t('账号已变化，请重新打开菜单。'));
      else if (author && (!authorKey || !authorScope)) setFeedback('unavailable', t('缺少可靠的 UP 或账号标识，无法隐藏该 UP。'));
      else setFeedback('confirm');
      return;
    }
    if (key === 'feedback-back') { setFeedback(''); return; }
    if (key === 'hide-local') { hideLocally(); return; }
    if (key === 'restore-local') { restoreLocal(isAuthor ? authorKey : hideKey); return; }
    if (key === 'restore-last') { setFeedbackKind('video'); restoreLocal(lastHiddenRecommendation(), 'video'); return; }
    if (key === 'restore-last-author') { setFeedbackKind('author'); restoreLocal(lastHiddenRecommendationAuthor(authorScope), 'author'); return; }
    if (key === 'feedback-send') { await sendFeedback(); return; }
    if (key === 'feedback-undo') { await sendFeedback(true); return; }
    if (key === 'follow') { await follow.toggle(); return; }
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

  // 菜单是"按住 OK 800ms"弹出来的,弹出来的那一刻**手还按着**。遥控器按住不放会
  // 连发 keydown,这些连发会立刻落到菜单上把第一项确认掉 —— 实测按住 2 秒就直接
  // 把视频加进了列表(owner:「不能一直长按就可以点击吧,得再按一次」)。
  // 所以菜单要先"解除保险":必须先看到一次**松手**,之后的 OK 才算数。
  const armedRef = useRef(false);
  useEffect(() => {
    const onUp = (e) => { if (e.key === 'Enter') armedRef.current = true; };
    const onKey = (e) => {
      const k = e.key;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'GoBack', 'Escape'].includes(k) && e.keyCode !== 461) return;
      claimRemoteFocus();
      e.preventDefault();
      e.stopPropagation();
      if (k === 'ArrowUp') setIdx(i => Math.max(0, i - 1));
      else if (k === 'ArrowDown') setIdx(i => Math.min(items.length - 1, i + 1));
      else if (k === 'ArrowLeft' || k === 'ArrowRight') return;
      else if (k === 'Enter') { if (armedRef.current && !e.repeat) { armedRef.current = false; run(items[idx]?.key); } }
      else onClose();
    };
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('keydown', onKey, true);   // 捕获阶段
    return () => {
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [idx, items.length, aid, busy, inList, follow.toggle, feedbackStage, feedbackKind, canSendFeedback, canHideFeedback, localRevision]);

  return (
    <div className="cardmenu-mask" onClick={onClose}>
      <div className="cardmenu" onClick={(e) => e.stopPropagation()}>
        <div className="cardmenu-title">{video?.title || ''}</div>
        {feedbackStage === 'confirm' && <div className="cardmenu-description">{canSendFeedback
          ? (isAuthor
            ? t('向哔哩哔哩反馈不想看该 UP 的推荐，不等同于拉黑账号。撤销需等待服务器确认。')
            : t('针对当前视频提交内容不感兴趣；平台可能调整类似推荐，不保证只影响这一条。撤销需等待服务器确认。'))
          : (isAuthor ? t('仅在本机隐藏该 UP 的推荐，不会向哔哩哔哩提交反馈，也不会拉黑账号。')
            : t('仅在本机推荐页隐藏，不会向哔哩哔哩提交反馈。'))}</div>}
        {feedbackStage === 'confirm' && <div className="cardmenu-description">{isAuthor
          ? (authorScope === 'guest' ? t('本机 UP 隐藏仅适用于未登录状态，不影响已登录账号。') : t('本机 UP 隐藏仅适用于当前账号，不影响此设备的其他账号。'))
          : t('本机隐藏适用于此设备的所有账号。')}</div>}
        {feedbackMessage && <div className="cardmenu-status" role="status">{feedbackMessage}</div>}
        {['submitting', 'undoing'].includes(feedbackStage) && <div className="cardmenu-description">{t('关闭菜单不会取消已发出的请求。')}</div>}
        {['submitted', 'undo-error', 'undo-unknown', 'restored'].includes(feedbackStage) && <div className="cardmenu-description">{t('恢复本机显示不会撤销已提交的反馈。')}</div>}
        {msg
          ? <div className="cardmenu-msg">{msg}</div>
          : items.map((it, i) => (
            <div key={it.key}
              role="button" aria-disabled={feedbackLock.current && it.key !== 'close' ? true : undefined}
              className={`cardmenu-item${i === idx ? ' focused' : ''}`}
              onMouseMove={() => setIdx(i)}
              onClick={event => { if (event.detail <= 1) run(it.key); }}>
              {it.label}
            </div>
          ))}
        {!feedbackStage && follow.message && <div className="cardmenu-status" role="status" style={{ fontSize: 20, padding: '12px 28px', lineHeight: 1.5 }}>{follow.message}</div>}
      </div>
    </div>
  );
}
