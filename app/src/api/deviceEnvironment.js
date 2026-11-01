// Real WebView fields only; no invented fingerprint or stored device profile.
export function deviceEnvironment() {
  try {
    return {ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,
      cores:navigator.hardwareConcurrency,width:screen.width,height:screen.height,
      availWidth:screen.availWidth,availHeight:screen.availHeight,depth:screen.colorDepth,
      offset:new Date().getTimezoneOffset(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  } catch { return null; }
}
