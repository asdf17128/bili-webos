import React, { memo, useSyncExternalStore, useRef } from 'react';
import Icon from '../components/Icon';
const StableIcon = memo(Icon);
import { t } from '../i18n';
import { formatCount } from '../utils/format';

function CoinIcon() {
  return (
    <svg className="coin-icon" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#ffc331" />
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9" />
      <text x="12" y="16.4" textAnchor="middle" fontSize="12" fontWeight="900" fill="#fff" fontFamily="Arial">B</text>
    </svg>
  );
}

export default memo(function PlayerPrimaryControls({ controlFocus, focusArea, CONTROLS, rel, stat, commentCount, inToView, engagementFeedback, ended, playing, disabledControls, disabledControlsRef, btnRefs, startLikeHold, endLikeHold, pressControl, setFocusArea, setFocusIdx, hideControlsLater, settingsOpen, likeRing, lastControlRef }) {
  const actions = useRef(null);
  actions.current = { startLikeHold, endLikeHold, pressControl, hover(i) {
    if (focusArea !== 'controls' || controlFocus.getSnapshot() !== i) endLikeHold(true);
    lastControlRef.current = CONTROLS[i];
    setFocusArea('controls'); setFocusIdx(i); hideControlsLater();
  } };
  const controlLabel = btn => btn === 'play' ? (ended ? t('重播') : playing ? t('暂停') : t('播放'))
    : btn === 'like' ? t('点赞') : btn === 'coin' ? t('投币') : btn === 'fav' ? t('收藏')
    : btn === 'later' ? t('稍后再看') : btn === 'prev' ? t('上一个') : btn === 'next' ? t('下一个')
    : btn === 'comments' ? t('评论') : t('设置');
  const controlValue = btn => btn === 'like' ? formatCount(stat.like) : btn === 'coin' ? formatCount(stat.coin)
    : btn === 'fav' ? formatCount(stat.favorite) : btn === 'comments' && commentCount ? formatCount(commentCount) : null;
  const controlStatus = btn => btn === 'like' && rel.liked ? t('已点赞')
    : btn === 'fav' && rel.faved ? t('已收藏')
    : btn === 'coin' && rel.coined > 0 ? t('已投 {n} 枚硬币', { n: rel.coined }) : null;
  return <>
        <div className="player-btns">
          {[['engagement', CONTROLS.slice(0, 4)], ['transport', CONTROLS.slice(4, 7)], ['tools', CONTROLS.slice(7)]].map(([group, buttons]) => (
            <div className={`player-control-group player-control-group-${group}`} key={group}>
              {buttons.map(btn => {
                const i = CONTROLS.indexOf(btn), label = controlLabel(btn);
                const value = controlValue(btn);
                const active = btn === 'like' ? rel.liked : btn === 'coin' ? rel.coined > 0 : btn === 'fav' ? rel.faved : btn === 'later' ? inToView : undefined;
                const engagement = ['like', 'coin', 'fav'].includes(btn);
                const feedback = engagementFeedback?.ids.includes(btn) ? engagementFeedback.state : null;
                return <ControlButton key={btn} btn={btn} i={i} label={label}
                  ariaLabel={btn === 'later' && inToView ? t('已稍后再看') : label}
                  value={value} active={active} engagement={engagement} feedback={feedback}
                  disabled={disabledControls.has(btn)} settingsOpen={btn === 'settings' && settingsOpen}
                  controlFocus={controlFocus} focusArea={focusArea}
                  icon={btn === 'play' ? (ended ? 'refresh' : playing ? 'pause' : 'play') : btn === 'fav' ? 'star' : btn}
                  coins={btn === 'coin' ? rel.coined : 0} likeRing={btn === 'like' ? likeRing : null}
                  btnRefs={btnRefs} actions={actions} />;
              })}
            </div>
          ))}
        </div>
        <ControlCaption controlFocus={controlFocus} focusArea={focusArea} CONTROLS={CONTROLS} lastControlRef={lastControlRef}
          engagementFeedback={engagementFeedback} controlLabel={controlLabel} controlValue={controlValue} controlStatus={controlStatus} />
  </>;
});

export function PlayerControlToast({ controlFocus, focusArea, controls, feedback, toast }) {
  const index = useSyncExternalStore(controlFocus.subscribe, controlFocus.getSnapshot);
  const focused = focusArea === 'controls' && feedback?.ids.includes(controls[index]) ? feedback : null;
  return toast && (!focused || toast !== focused.message)
    ? <div className={`player-toast ${toast === feedback?.message ? 'engagement-toast' : ''}`}>{toast}</div> : null;
}

const ControlButton = memo(function ControlButton({ btn, i, label, ariaLabel, value, active, engagement, feedback, disabled, settingsOpen, controlFocus, focusArea, icon, coins, likeRing, btnRefs, actions }) {
  const focused = useSyncExternalStore(controlFocus.subscribe, () => focusArea === 'controls' && controlFocus.getSnapshot() === i);
                const handlers = btn === 'like' ? {
                  onMouseDown: event => { if (event.button === 0 && !disabled) actions.current.startLikeHold(); },
                  onMouseUp: event => { if (event.button === 0) actions.current.endLikeHold(false); },
                  onMouseLeave: () => actions.current.endLikeHold(true),
                } : { onClick: () => actions.current.pressControl(btn) };
                return <button type="button" data-control={btn}
                  ref={el => { btnRefs.current[btn] = el; }} disabled={disabled} aria-disabled={disabled}
                  aria-label={ariaLabel} aria-pressed={active}
                  aria-busy={engagement ? feedback === 'pending' : undefined} data-feedback={feedback || undefined}
                  aria-haspopup={btn === 'settings' ? 'dialog' : undefined}
                  aria-expanded={btn === 'settings' ? settingsOpen : undefined}
                  className={`player-btn player-control ${focused ? 'focused' : ''} ${active ? 'lit' : ''} ${feedback === 'success' ? 'triple-pop' : ''}`}
                  onMouseMove={() => actions.current.hover(i)}
                  {...handlers}>
                  <span className="player-control-icon">{btn === 'coin' ? <CoinIcon /> : <StableIcon size={28}
                    name={icon} />}
                  {feedback === 'pending' && <span className="player-control-spinner" aria-hidden="true" />}
                  {engagement && ((btn === 'coin' && active) || feedback === 'error') && <span className="player-control-status" aria-hidden="true">
                    {feedback === 'error' ? '!' : coins}
                  </span>}
                  {btn === 'like' && likeRing && <svg className="like-ring" aria-hidden="true" width={likeRing.w + 8} height={likeRing.h + 8} style={{ left: -10, top: -10 }}>
                    <rect className="like-ring-track" x="4" y="4" width={likeRing.w} height={likeRing.h} rx={likeRing.rx} />
                    <rect className="like-ring-fill" x="4" y="4" width={likeRing.w} height={likeRing.h} rx={likeRing.rx}
                      style={{ strokeDasharray: likeRing.perim, strokeDashoffset: likeRing.perim }} />
                  </svg>}
                  </span>
                  <span className="player-control-label">{label}</span>
                  {value != null && <span className="player-control-value">{value}</span>}
                </button>;
});

function ControlCaption({ controlFocus, focusArea, CONTROLS, lastControlRef, engagementFeedback, controlLabel, controlValue, controlStatus }) {
  const focusIdx = useSyncExternalStore(controlFocus.subscribe, controlFocus.getSnapshot);
  if (focusArea === 'controls' && CONTROLS[focusIdx]) lastControlRef.current = CONTROLS[focusIdx];
  const focusedControl = focusArea === 'controls' ? CONTROLS[focusIdx] : null;
  const focusedFeedback = focusedControl && engagementFeedback?.ids.includes(focusedControl) ? engagementFeedback : null;
  const controlCaption = focusedFeedback ? focusedFeedback.message : focusedControl
    ? `${controlStatus(focusedControl) || controlLabel(focusedControl)} ${controlValue(focusedControl) || ''}` : '\u00a0';
  return <div className={`player-control-caption ${focusedFeedback ? 'feedback-' + focusedFeedback.state : ''}`} role="status" aria-live="polite">{controlCaption}</div>;
}
