// In-app error ring buffer for the 网络诊断 page (#10/#13). On a user's TV the
// console is invisible; this keeps the last ~30 failures (network transport
// errors, HTTP failures, risk-control codes, JS errors) so the diagnostics
// screen and its scan-to-report QR can show WHY something broke, not just
// "暂无内容".

const MAX = 30;
const errors = [];

export function logErr(tag, detail) {
  errors.push({ t: Date.now(), tag, d: String(detail).slice(0, 200) });
  if (errors.length > MAX) errors.shift();
}

export function getErrors() { return errors.slice(); }

// Capture uncaught JS errors too — on webOS 5/6 these were the blank-screen
// class of bugs and users could never tell us what threw.
let hooked = false;
export function initErrorHooks() {
  if (hooked) return;
  hooked = true;
  window.addEventListener('error', (e) => {
    logErr('js', (e.message || 'error') + (e.filename ? ` @${e.filename.split('/').pop()}:${e.lineno}` : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    logErr('promise', (r && (r.message || r.toString())) || 'unhandled rejection');
  });
}
