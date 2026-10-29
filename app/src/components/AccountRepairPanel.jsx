import React, { useEffect, useRef, useState } from 'react';
import { accountRepair } from '../api/client';
import { claimRemoteFocus, getCurrentFocusId, setFocus } from '../hooks/useFocus';
import { holdPrefetch } from '../utils/perfFlags';
import { t } from '../i18n';

function resultText(result) {
  if (!result) return '';
  if (result.status === 'repaired') return result.reason === 'local-refresh-failed'
    ? t('设备标识已更新，本机缓存刷新未完成。请重启应用后检查。')
    : t('设备标识已更新，登录凭据已保留。请返回视频手动重试；尚未验证播放恢复。');
  if (result.status === 'session-changed') return t('账号状态已变化，请重新检查。');
  if (result.deviceOutcome === 'unknown') return t('修复结果未知，请先检查状态；不会自动重试。');
  if (result.status === 'login-required') return t('登录已失效或尚未登录，可选择重新扫码登录。');
  if (result.status === 'checked') return t('账号检查完成。登录有效不代表播放已恢复。');
  if (result.status === 'refreshed') return t('临时缓存已刷新，未清除登录或设备标识。');
  if (result.status === 'busy') return t('已有修复操作进行中，请稍后检查。');
  if (result.status === 'cooldown') return t('操作过于频繁，请等待后重新检查。');
  if (result.status === 'unavailable') return t('修复服务暂不可用，请检查服务或更新应用。');
  if (result.action === 'device' && result.deviceOutcome === 'unchanged') return t('本次未更新设备标识，旧值已保留。请稍后再检查。');
  if (result.status === 'timeout') return t('检查超时，账号与设备标识未清除。');
  return t('检查未完成，账号与设备标识未清除。');
}

export default function AccountRepairPanel({ onClose, onRequestLogin }) {
  const [stage, setStage] = useState('main');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [service, setService] = useState(null);
  const [remaining, setRemaining] = useState(0);
  // Count down locally, then verify with the service. Never unlock on the
  // local clock alone: another playback request may have started a cooldown.
  useEffect(() => {
    if (!service || busy) return;
    let stopped = false, timer;
    const deadline = Date.now() + (service.retryAfterSeconds || 0) * 1000;
    setRemaining(service.retryAfterSeconds || 0);
    const tick = async () => {
      if (stopped) return;
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds > 0) { timer = setTimeout(tick, 1000); return; }
      if (!service.retryAfterSeconds && !service.busy) return;
      const result = await accountRepair.status();
      if (!stopped && mounted.current) setService(result.service || null);
    };
    timer = setTimeout(tick, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [service, busy]);
  // The opener's keyup may precede this component's effect. Its keydown has
  // already passed window capture; ignore repeats and arm the next fresh press.
  const mounted = useRef(true), pending = useRef(false), armed = useRef(true);
  const originalFocus = useRef(getCurrentFocusId());
  const dialog = useRef(null);
  useEffect(() => {
    const release = holdPrefetch();
    return () => { mounted.current = false; release(); setFocus(originalFocus.current); };
  }, []);
  const changeStage = next => { setStage(next); setSelected(0); };
  const execute = async action => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setReport(null); changeStage('main');
    try {
      const result = action === 'device' ? await accountRepair.repairDevice({ confirm: true })
        : await accountRepair[action]();
      if (!mounted.current) return;
      setReport(result);
      if (result.service) setService(result.service);
      else if (action !== 'device' || result.status === 'session-changed') setService(null);
      if (action === 'device') {
        // Re-check before offering another device operation, including after a
        // lost response. The service enforces the authoritative cooldown.
        setService(null);
      }
    } catch {
      if (mounted.current) {
        setReport({ action, status: action === 'device' ? 'unknown' : 'failed',
          deviceOutcome: action === 'device' ? 'unknown' : 'not-requested' });
        setService(null);
      }
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setSelected(0); }
    }
  };
  const deviceAvailable = service?.supported === true && !service.busy && !service.retryAfterSeconds;
  let actions;
  if (busy) actions = [{ label: t('关闭'), run: onClose }];
  else if (stage === 'device') actions = [
    { label: t('取消'), run: () => changeStage('main') },
    { label: t('确认重建设备标识'), run: () => execute('device') },
  ];
  else if (stage === 'login') actions = [
    { label: t('取消'), run: () => changeStage('main') },
    { label: t('打开登录二维码'), run: onRequestLogin },
  ];
  else actions = [
    { label: t('检查账号'), run: () => execute('check') },
    { label: t('刷新临时缓存'), run: () => execute('refresh') },
    { label: t('重建设备标识'), disabled: !deviceAvailable, run: () => changeStage('device') },
    { label: t('重新扫码登录'), run: () => changeStage('login') },
    { label: t('关闭'), run: onClose },
  ];
  const activate = index => {
    const action = actions[index];
    if (action && !action.disabled) action.run?.();
  };
  useEffect(() => {
    const up = event => { if (event.key === 'Enter') armed.current = true; };
    const key = event => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'GoBack'].includes(event.key) && event.keyCode !== 461) return;
      claimRemoteFocus(); event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === 'ArrowUp') setSelected(index => Math.max(0, index - 1));
      else if (event.key === 'ArrowDown') setSelected(index => Math.min(actions.length - 1, index + 1));
      else if (event.key === 'Enter') {
        if (armed.current) { armed.current = false; activate(selected); }
      } else if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        if (stage !== 'main') changeStage('main'); else onClose();
      }
    };
    const wheel = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('keyup', up, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', wheel, true);
    };
  }, [selected, actions.length, stage, busy, deviceAvailable, onClose, onRequestLogin]);
  useEffect(() => {
    dialog.current?.querySelector('.account-repair-action.focused')?.scrollIntoView({ block: 'nearest' });
  }, [selected, stage, busy]);
  return <div className="account-repair-mask">
    <section ref={dialog} className="account-repair-dialog" role="dialog" aria-modal="true" aria-labelledby="account-repair-title">
      <h2 id="account-repair-title">{t('账号修复')}</h2>
      {stage === 'device' ? <>
        <p>{t('将向哔哩哔哩申请一套新设备标识；保留登录凭据、观看进度和应用设置。')}</p>
        <p>{t('仅在完整校验并保存成功后替换旧值。失败保留旧值；成功后不能自动还原，也不保证解除风控。')}</p>
        <p>{t('每次确认只尝试一次，五分钟内不重复。不会自动播放视频。')}</p>
      </> : stage === 'login' ? <>
        <p>{t('不会先退出当前账号。请用手机确认登录，成功后会更新为扫码账号。')}</p>
        <p>{t('二维码生成失败或取消时，不主动清除现有登录。重新登录不一定能解决设备标识问题。')}</p>
      </> : <>
        <p>{t('先检查账号，再刷新临时缓存；仍有问题时再选择设备标识或重新登录。')}</p>
        <p className="account-repair-note">{t('修复结果只显示状态和错误码，不包含账号、Cookie、IP 或设备标识。')}</p>
        {report && <div className="account-repair-result" role="status">
          <p>{resultText(report)}</p>
          {report.login && <p>{t('登录状态：')}{report.login === 'valid' ? t('有效') : report.login === 'invalid' ? t('未登录或已失效') : t('未确认')}</p>}
          {Number.isInteger(report.code) && <p>{t('接口错误码：{code}', { code: report.code })}</p>}
          {report.cacheCleared && report.action !== 'device' && report.status !== 'refreshed' && <p>{t('临时缓存已刷新，未清除登录或设备标识。')}</p>}
        </div>}
        {service?.supported === true ? <p className="account-repair-note">{service.busy
          ? t('已有修复操作进行中，请稍后检查。')
          : service.retryAfterSeconds ? t('冷却剩余 {n} 秒，结束后自动检查。', { n: remaining })
          : service.hasDeviceIdentity ? t('已检测到设备标识；重建需要单独确认。') : t('未检测到完整设备标识，可主动尝试重建。')}</p>
          : <p className="account-repair-note">{t('请先检查账号；服务支持此功能后才能重建设备标识。')}</p>}
        {busy && <p role="status">{t('正在处理…关闭窗口不会取消已发出的请求。')}</p>}
      </>}
      <div className="account-repair-actions">{actions.map((action, index) => <button key={action.label} type="button"
        className={`account-repair-action${selected === index ? ' focused' : ''}`}
        aria-disabled={!!action.disabled}
        onMouseMove={() => {
          // Layout under a stationary pointer must not override default Cancel.
          setSelected(index);
        }}
        onClick={event => { if (event.detail <= 1) activate(index); }}>{action.label}</button>)}</div>
    </section>
  </div>;
}
