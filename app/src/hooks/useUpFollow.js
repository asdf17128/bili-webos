import { useEffect, useRef, useState } from 'react';
import { getUpRelation, setUpFollow } from '../api/client';
import { storage } from '../utils/storage';
import { updateFollowedMid } from '../utils/follow';
import { t } from '../i18n';

// Read the relationship for this UP, not the potentially incomplete list cache.
// Only an explicit press writes; stale reads and repeated OK cannot toggle twice.
export function useUpFollow(mid, enabled = true) {
  mid = Number(mid) || 0;
  const auth = storage.getAuth();
  const account = auth?.SESSDATA || '';
  const self = mid && String(mid) === String(auth?.DedeUserID);
  const [state, setState] = useState({ followed: null, busy: false, message: '' });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0), lock = useRef(null);
  useEffect(() => {
    const id = ++generation.current;
    lock.current = null;
    setState({ followed: null, busy: false, message: '' });
    if (!enabled || !mid || !account || self) return;
    getUpRelation(mid).then(r => {
      if (id !== generation.current) return;
      if (r?.code !== 0 || typeof r?.data?.attribute !== 'number') throw new Error('relation unavailable');
      setState({ followed: (r.data.attribute & 2) !== 0, busy: false, message: '' });
    }).catch(() => {
      if (id === generation.current) setState({ followed: null, busy: false, message: t('关注状态读取失败，请重试') });
    });
    return () => { generation.current++; };
  }, [mid, enabled, account, self, refresh]);
  useEffect(() => {
    const changed = e => {
      if (Number(e.detail?.mid) !== mid) return;
      generation.current++;
      setState({ followed: e.detail.followed, busy: false, message: '' });
    };
    window.addEventListener('follow-changed', changed);
    return () => window.removeEventListener('follow-changed', changed);
  }, [mid]);
  const toggle = async () => {
    if (!account) { const message = t('请先登录后关注 UP 主'); setState(s => ({ ...s, message })); return message; }
    if (!mid || self || lock.current != null) return '';
    if (state.followed == null) { setRefresh(n => n + 1); return t('正在读取关注状态'); }
    const id = generation.current, followed = !state.followed;
    lock.current = id;
    setState(s => ({ ...s, busy: true, message: '' }));
    try {
      const r = await setUpFollow(mid, followed);
      if (storage.getAuth()?.SESSDATA !== account) return '';
      if (r?.code !== 0) throw new Error('follow rejected');
      const current = id === generation.current;
      // A confirmed server write still updates the card cache if the user
      // has already closed the menu. Only its old component UI is discarded.
      updateFollowedMid(mid, followed);
      if (!current) return '';
      const message = followed ? t('已关注 UP 主') : t('已取消关注');
      setState({ followed, busy: false, message });
      return message;
    } catch {
      if (id !== generation.current) return '';
      const message = t('关注操作失败，请重试');
      setState(s => ({ ...s, busy: false, message }));
      return message;
    } finally {
      if (lock.current === id) lock.current = null;
    }
  };
  return { ...state, available: !!mid && !self,
    label: state.busy ? t('处理中…') : state.followed ? t('取消关注 UP 主') : t('关注 UP 主'), toggle };
}
