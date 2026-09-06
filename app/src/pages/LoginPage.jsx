import React, { useState, useEffect, useRef } from 'react';
import { qrCodeGenerate, qrCodePoll } from '../api/client';
import { storage } from '../utils/storage';
import { cancelContentFocus } from '../hooks/useFocus';
import { holdPrefetch } from '../utils/perfFlags';
import QRCode from 'qrcode';
import { t } from '../i18n';

export default function LoginPage({ onLogin, onClose }) {
  const [status, setStatus] = useState('waiting');
  const [qrUrl, setQrUrl] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(0);
  const canvasRef = useRef(null);
  useEffect(() => holdPrefetch(), []);

  useEffect(() => {
    let alive = true, timer;
    cancelContentFocus();
    setStatus('waiting'); setQrUrl(''); setSelected(0);
    const later = (fn, ms) => { if (alive) timer = setTimeout(fn, ms); };
    const generate = async () => {
      try {
        const res = await qrCodeGenerate();
        if (!alive) return;
        if (!res?.data?.url || !res?.data?.qrcode_key) throw new Error('QR unavailable');
        setQrUrl(res.data.url); setStatus('waiting');
        const poll = async () => {
          try {
            const result = await qrCodePoll(res.data.qrcode_key);
            if (!alive) return;
            const code = result?.data?.code;
            if (code === 0) {
              setStatus('success');
              storage.setAuth({ ...(storage.getAuth() || {}), refresh_token: result.data.refresh_token });
              later(onLogin, 800); return;
            }
            if (code === 86038) {
              setStatus('expired'); setQrUrl(''); later(generate, 1000); return;
            }
            if (code === 86090) setStatus('scanned');
            later(poll, 2000);
          } catch (e) { if (alive) { setStatus('error'); setQrUrl(''); } }
        };
        later(poll, 2000);
      } catch (e) { if (alive) setStatus('error'); }
    };
    generate();
    return () => { alive = false; clearTimeout(timer); };
  }, [retry, onLogin]);

  useEffect(() => {
    if (qrUrl && canvasRef.current) QRCode.toCanvas(canvasRef.current, qrUrl, {
      width: 320, margin: 2, color: { dark: '#000', light: '#fff' },
    }).catch(() => setStatus('error'));
  }, [qrUrl]);

  const actions = status === 'error'
    ? [{ label: t('重试'), run: () => setRetry(n => n + 1) }, { label: t('暂不登录'), run: onClose }]
    : [{ label: t('暂不登录'), run: onClose }];
  // Capture at the modal boundary so arrows, OK and the wheel cannot operate
  // the still-mounted page underneath. Closing keeps its previous focus intact.
  useEffect(() => {
    const handler = e => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'GoBack'].includes(e.key) && e.keyCode !== 461) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.keyCode === 461 || ['Escape', 'Backspace', 'GoBack'].includes(e.key)) onClose?.();
      else if (e.key === 'Enter') actions[Math.min(selected, actions.length - 1)].run?.();
      else setSelected(i => (i + 1) % actions.length);
    };
    const blockWheel = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('wheel', blockWheel, { capture: true, passive: false });
    return () => { window.removeEventListener('keydown', handler, true); window.removeEventListener('wheel', blockWheel, true); };
  }, [status, selected, onClose]);

  const text = {
    waiting: t('请使用哔哩哔哩手机客户端扫描二维码'), scanned: t('已扫描，请在手机上确认登录'),
    expired: t('二维码已过期，正在刷新...'), success: t('登录成功！'), error: t('登录失败，请重试'),
  };
  return <div className="login-page" role="dialog" aria-modal="true" aria-labelledby="login-title">
    <h1 id="login-title">{t('扫码登录')}</h1>
    <p className="login-subtitle">{t('扫码登录，同步你的关注与收藏')}</p>
    <div className="login-qr">
      {qrUrl ? <canvas ref={canvasRef} /> : status === 'error' ? <span className="login-qr-error">◇</span> : <div className="loading-spinner" />}
    </div>
    <div className="login-tip" role="status">{text[status]}</div>
    <div className="login-actions">{actions.map((action, index) => <button type="button" key={action.label}
      className={`tv-action${Math.min(selected, actions.length - 1) === index ? ' focused' : ''}`}
      onMouseEnter={() => setSelected(index)} onClick={action.run}>{action.label}</button>)}</div>
    <p className="login-back-hint">{t('返回键关闭，继续浏览')}</p>
  </div>;
}
