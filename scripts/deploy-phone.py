#!/usr/bin/env python3
"""Build and install the unified pairing component and pixel AIUI, preserving data."""
import argparse,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--serial');p.add_argument('--sdk-token-file',type=Path);p.add_argument('--rebind',action='store_true');args=p.parse_args()
release=ROOT.parent/'rokid-muse-pairing-complete-0.3.1'
subprocess.run(['python3',str(ROOT/'scripts/build-release.py'),'--output',str(release)],check=True)
command=['python3',str(release/'rokid-muse-pairing/scripts/setup.py'),'setup']
if args.serial:command+=['--serial',args.serial]
if args.sdk_token_file:command+=['--sdk-token-file',str(args.sdk_token_file)]
if args.rebind:command+=['--rebind']
subprocess.run(command,check=True)
