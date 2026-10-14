"""Build a portable, dependency-free home-network diagnostic ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
paths = [
    'tools/test-region-network.mjs',
    'tools/probe-region.py',
    'app/src/api/wbi.js',
    'app/src/player/cdn.js',
    'app/src/player/cdnAuto.js',
    'app/src/player/cdnProbe.js',
    'service/com.biliwebos.app.service/biliReferer.js',
    'LICENSE',
]
files = {name: (root / name).read_bytes() for name in paths}
files['README.md'] = (root / 'docs/NETWORK-CHECK-QUICKSTART.md').read_bytes()
files['app/package.json'] = b'{"type":"module"}\n'
files['manifest.json'] = (json.dumps({
    'purpose': 'Anonymous home-network diagnostics; no TV firmware or app installer',
    'sha256': {name: hashlib.sha256(body).hexdigest() for name, body in files.items()},
}, indent=2) + '\n').encode()
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, 'w') as archive:
    for name, body in files.items():
        info = ZipInfo('bili-network-check/' + name)
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, body)
print(json.dumps({'path': str(args.output), 'bytes': args.output.stat().st_size,
                  'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))
