// B站 接口错误码 → 用户能照着做的提示。
//
// 来由:issue #20 / #23 两位用户贴的诊断里都只有一行 `playurl code=-351`,
// 而播放器那边给的是泛泛的「视频加载失败」——用户既不知道这是风控,
// 更不知道**登录通常就能解决**。错误码本身对用户是没有信息量的。
//
// 两处共用一份映射(诊断面板 + 播放器),免得两边文案漂移。
import { t } from '../i18n/index.js';

// An error code alone cannot identify an account restriction. CDN selection
// changes media requests, not API verification (#23 / ranking Referer evidence).
export function apiErrorHint(code, ctx) {
  if (code === -351 || code === -352) {
    return ctx && ctx.loggedIn
      ? t('B站 风控校验未通过 · 请先在官方客户端检查同一账号是否正常，再重试或提交网络诊断')
      : t('B站 风控校验未通过 · 可先扫码登录后重试，仍失败请提交网络诊断');
  }
  // -412 = 请求被拦截。2026-09-02(issue #25)实测:海外 IP + 匿名时 B站 把
  // view 接口整个拦了(连 HTML 拦截页都返回)。登录通常可解;我们对 view
  // 有 pagelist 兜底,所以走到这里说明连兜底都没成。
  if (code === -412) {
    return ctx && ctx.loggedIn
      ? t('B站 拦截了请求(-412)· 当前账号或网络被风控,可在设置里换 CDN 线路后重试')
      : t('B站 拦截了请求(-412)· 常见于海外网络未登录:先试试登录(设置 → 扫码登录)');
  }
  if (code === -10403) return t('该内容在当前地区不可观看');
  if (code === -404 || code === 62002 || code === 62004) return t('稿件不存在、已失效或未公开');
  if (code === -403) return t('没有权限观看(可能需要大会员或充电专属)');
  return null;   // null = 没有专门的说法,调用方回落到自己的默认文案
}
