// Bounded, allowlisted evidence. Never retain response bodies, headers, cookie
// values, voucher values, titles or full URLs, including transient errors.
module.exports = function () {
  var rows = [], sequence = 0, lastFailure = null;
  function number(value) { if (value == null) return null; var n = Number(value); return isFinite(n) && n >= 0 && n <= 9007199254740991 ? n : null; }
  function kind(parsed) {
    if (parsed.hostname !== 'api.bilibili.com') return null;
    return {'/x/player/playurl':'ugc','/x/player/wbi/playurl':'wbi','/pgc/player/web/playurl':'pgc'}[parsed.pathname] || null;
  }
  function error(err) {
    var text = String(err && (err.code || err.message) || '');
    if (/timeout|deadline|ETIMEDOUT/i.test(text)) return 'timeout';
    if (/cooldown/.test(text)) return 'cooldown';
    if (/persist/.test(text)) return 'persistence';
    if (/session changed/.test(text)) return 'session_changed';
    if (/JSON|fingerprint response|usable buvid/.test(text)) return 'invalid_response';
    if (/ECONNRESET|aborted|hang up/.test(text)) return 'reset';
    if (/ENOTFOUND|EAI_/.test(text)) return 'dns';
    return 'transport';
  }
  return {
    begin: function (parsed, probe) {
      var type = kind(parsed); if (!type) return null;
      var q = parsed.searchParams, row = {id:++sequence,kind:type,probe:!!probe,at:Date.now(),attempts:[],recovery:'none'};
      var bvid = q.get('bvid'); if (/^BV[a-zA-Z0-9]{10}$/.test(bvid || '')) row.bvid = bvid;
      ['cid','ep_id','qn','fnval'].forEach(function(k){var v=q.get(k);if(v!==null&&number(v)!==null)row[k]=number(v);});
      rows.push(row);if(rows.length>8)rows.shift();return row;
    },
    response: function(row,status,body,err,started) {
      if(!row)return;
      var a={http:number(status),ms:Math.max(0,Date.now()-started)};
      if(err)a.error=error(err);
      else {
        var j;try{j=JSON.parse(body.toString('utf-8'));}catch(e){a.error='non_json';}
        if(j){var d=j.data||j.result||{};a.code=typeof j.code==='number'&&isFinite(j.code)?j.code:null;a.voucher=!!d.v_voucher;a.stream=!!((d.dash&&d.dash.video&&d.dash.video.length)||(d.durl&&d.durl.length));}
      }
      if(row.attempts.length<2)row.attempts.push(a);
      row.outcome = a.error || a.http !== 200 || a.code !== 0 || !a.stream ? 'failed' : 'ok';
      if (!row.probe && (row.outcome === 'failed' || (lastFailure && lastFailure.id === row.id))) lastFailure=JSON.parse(JSON.stringify(row));
    },
    recovery: function(row,state,err) {
      if(!row)return;row.recovery=err?error(err):state;
      if(lastFailure&&lastFailure.id===row.id)lastFailure.recovery=row.recovery;
    },
    snapshot: function() { return JSON.parse(JSON.stringify({schema:1,recent:rows,lastFailure:lastFailure})); }
  };
};
