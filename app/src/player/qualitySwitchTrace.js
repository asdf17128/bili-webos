import { describePlayResponse, diagnosticError } from '../utils/diagnosticReport.js';

// A separate trace: restoring the previous stream must not erase why the
// requested quality failed. Never retain response bodies or error messages.
export function createQualitySwitchTrace(publish, { kind, requested, now = Date.now } = {}) {
  const started = now();
  const row = { kind, requested, state: 'loading', stage: 'url' };
  const emit = () => publish({ ...row, ms: Math.max(0, now() - started) });
  emit();
  return {
    stage(value) { row.stage = value; emit(); },
    media(rep, dolby) {
      row.selected = Number(rep?.id);
      const [n, d = '1'] = String(rep?.frameRate || rep?.frame_rate || '').split('/');
      const fps = Number(n) / Number(d);
      row.fps = Number.isFinite(fps) && fps > 0 ? fps : undefined;
      row.profile = dolby?.profile;
      emit();
    },
    async measure(stage, fn) {
      row.stage = stage; emit();
      const result = await fn();
      if (stage === 'url') Object.assign(row, describePlayResponse(result));
      emit(); return result;
    },
    ready(served) { row.state = 'ready'; row.served = served; emit(); },
    fail(error) {
      row.state = 'failed';
      if (!row.reason) {
        const failure = diagnosticError(error); row.reason = failure.reason;
        if (row.code == null) row.code = failure.code;
      }
      row.mediaCode = Number.isInteger(error?.code) ? error.code : undefined;
      row.category = Number.isInteger(error?.category) ? error.category : undefined;
      emit();
    },
  };
}
