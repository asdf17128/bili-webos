// Real WebView fields only; no invented fingerprint or stored device profile.
export function deviceEnvironment() {
  try {
    const environment = {ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,
      cores:navigator.hardwareConcurrency,width:screen.width,height:screen.height,
      availWidth:screen.availWidth,availHeight:screen.availHeight,depth:screen.colorDepth,
      offset:new Date().getTimezoneOffset()};
    // Older TV browsers may lack Intl or an IANA timezone. Keep the other
    // observed fields rather than dropping the entire recovery profile.
    try { environment.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
    return environment;
  } catch { return null; }
}
