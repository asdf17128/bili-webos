"""Ephemeral JSON-lines worker used by test-region-network.mjs over SSH stdin.
No files, account credentials, or server configuration changes.
"""
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
cookies = ''

def request(job):
    global cookies
    headers = {'User-Agent': UA, 'Referer': job.get('referer', 'https://www.bilibili.com/')}
    if job['op'] == 'api':
        headers['Origin'] = 'https://www.bilibili.com'
        if cookies:
            headers['Cookie'] = cookies
    elif job['op'] == 'range':
        headers['Range'] = 'bytes=%s-%s' % (job['start'], job['end'])
    started = time.monotonic()
    timeout = job.get('timeoutMs', 10000) / 1000
    with urllib.request.urlopen(urllib.request.Request(job['url'], headers=headers), timeout=timeout) as response:
        if job['op'] == 'range':
            match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
            if response.status != 206 or not match:
                raise ValueError('invalid HTTP range status/headers')
            start, end, total = map(int, match.groups())
            if start != job['start'] or end > job['end'] or end < start or end >= total or (end != job['end'] and end != total - 1):
                raise ValueError('wrong HTTP range')
            chunks, size = [], 0
            while True:
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError('body deadline')
                response.fp.raw._sock.settimeout(remaining)
                part = response.read1(min(16384, end - start + 2 - size))
                if not part:
                    break
                chunks.append(part)
                size += len(part)
                if size > end - start + 1:
                    raise ValueError('oversized range')
                if size == end - start + 1:
                    break
            if size != end - start + 1:
                raise ValueError('incomplete range')
            return {'bytes': size, 'total': total, 'ms': max(1, (time.monotonic() - started) * 1000), 'sha256': hashlib.sha256(b''.join(chunks)).hexdigest()}
        body = response.read(4 * 1024 * 1024)
        if job['op'] == 'location':
            # Return country code only, never publish the server's IP.
            return {'loc': dict(line.split('=', 1) for line in body.decode().splitlines() if '=' in line).get('loc')}
        data = json.loads(body)
        if '/finger/spi' in job['url'] and data.get('code') == 0:
            value = data.get('data', {})
            cookies = '; '.join(k + '=' + value[v] for k, v in [('buvid3', 'b_3'), ('buvid4', 'b_4')] if value.get(v))
        return data

for line in sys.stdin:
    try:
        job = json.loads(line)
        result = {'value': request(job)}
    except urllib.error.HTTPError as error:
        if job['op'] == 'api':
            # Match smartFetch: API HTTP errors reach getVideoInfo as response
            # metadata so its existing 412 -> pagelist fallback can run.
            try:
                value = json.loads(error.read(4 * 1024 * 1024))
            except Exception:
                value = {'status': error.code}
            result = {'value': value}
        else:
            result = {'error': type(error).__name__, 'status': error.code}
    except Exception as error:
        # Exception strings can embed signed URLs. Only report type/status.
        result = {'error': type(error).__name__, 'status': getattr(error, 'code', None)}
    print(json.dumps(result), flush=True)
