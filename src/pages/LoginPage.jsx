import React, { useState, useEffect, useRef, useCallback } from 'react';
import { qrCodeGenerate, qrCodePoll } from '../api/client';
import { storage } from '../utils/storage';
import QRCode from 'qrcode';

const STATUS_TEXT = {
  waiting: '请使用哔哩哔哩手机客户端扫描二维码',
  scanned: '已扫描，请在手机上确认登录',
  expired: '二维码已过期，正在刷新...',
  success: '登录成功！',
  error: '登录失败，请重试',
};

export default function LoginPage({ onLogin }) {
  const [status, setStatus] = useState('waiting');
  const [qrUrl, setQrUrl] = useState('');
  const canvasRef = useRef(null);
  const pollTimer = useRef(null);
  const qrcodeKey = useRef('');

  const generateQR = useCallback(async () => {
    try {
      setStatus('waiting');
      const res = await qrCodeGenerate();
      if (res?.data?.url && res?.data?.qrcode_key) {
        setQrUrl(res.data.url);
        qrcodeKey.current = res.data.qrcode_key;
        startPolling();
      } else {
        setStatus('error');
      }
    } catch (err) {
      console.error('QR generate failed:', err);
      setStatus('error');
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await qrCodePoll(qrcodeKey.current);
        const code = res?.data?.code;
        if (code === 0) {
          // Login success
          clearInterval(pollTimer.current);
          setStatus('success');
          // Extract tokens from response
          const { refresh_token } = res.data;
          const auth = storage.getAuth() || {};
          storage.setAuth({ ...auth, refresh_token });
          setTimeout(() => onLogin(), 800);
        } else if (code === 86090) {
          setStatus('scanned');
        } else if (code === 86038) {
          setStatus('expired');
          clearInterval(pollTimer.current);
          setTimeout(generateQR, 1000);
        }
        // 86101 = not scanned yet, keep polling
      } catch (err) {
        console.error('QR poll failed:', err);
      }
    }, 2000);
  }, [generateQR, onLogin]);

  useEffect(() => {
    generateQR();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [generateQR]);

  // Render QR code to canvas
  useEffect(() => {
    if (qrUrl && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#000', light: '#fff' },
      });
    }
  }, [qrUrl]);

  const statusColor = status === 'success' ? '#52c41a' :
    status === 'scanned' ? '#faad14' :
      status === 'error' || status === 'expired' ? '#ff4d4f' : '#8888a0';

  return (
    <div className="login-page">
      <h2 style={{ fontSize: 36, marginBottom: 30, color: '#00a1d6' }}>哔哩哔哩</h2>
      <div className="login-qr">
        <canvas ref={canvasRef} />
      </div>
      <div className="login-tip">{STATUS_TEXT[status]}</div>
      <div className="login-status" style={{ color: statusColor }}>
        {status === 'expired' && '🔄'}
        {status === 'scanned' && '📱'}
        {status === 'success' && '✅'}
      </div>
    </div>
  );
}
