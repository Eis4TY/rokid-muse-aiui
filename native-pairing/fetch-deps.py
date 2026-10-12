#!/usr/bin/env python3
"""Pinned Java dependencies, fetched from the Aliyun Maven mirror."""
from pathlib import Path
import hashlib,urllib.request
BASE='https://maven.aliyun.com/repository/central/'
DEPS={
 'com/squareup/okhttp3/okhttp/3.14.9/okhttp-3.14.9.jar':'2570fab55515cbf881d7a4ceef49fc515490bc027057e666776a2832465aeca0',
 'com/squareup/okio/okio/1.17.2/okio-1.17.2.jar':'f80ce42d2ffac47ad4c47e1d6f980d604d247ceb1a886705cf4581ab0c9fe2b8',
 'org/bouncycastle/bcprov-jdk18on/1.78.1/bcprov-jdk18on-1.78.1.jar':'add5915e6acfc6ab5836e1fd8a5e21c6488536a8c1f21f386eeb3bf280b702d7',
}
root=Path(__file__).resolve().parent/'deps';root.mkdir(exist_ok=True)
for path,digest in DEPS.items():
 dest=root/path.rsplit('/',1)[-1]
 raw=dest.read_bytes() if dest.exists() else urllib.request.urlopen(BASE+path,timeout=30).read()
 if hashlib.sha256(raw).hexdigest()!=digest:raise SystemExit('Dependency hash mismatch: '+dest.name)
 if not dest.exists():dest.write_bytes(raw)
 print('Verified '+dest.name)
