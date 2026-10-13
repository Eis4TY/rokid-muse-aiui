#!/usr/bin/env python3
"""Build a public, credential-free pairing toolkit from explicit source files."""
import argparse,json,shutil,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT.parent/'rokid-muse-pairing-complete-0.3.1');p.add_argument('--skip-native-build',action='store_true');args=p.parse_args()
output=args.output.resolve();skill=output/'rokid-muse-pairing'
if output==ROOT or ROOT in output.parents:raise SystemExit('输出必须位于工程外。')
if not args.skip_native_build:subprocess.run(['sh',str(ROOT/'native-pairing/build.sh')],check=True)
shutil.copytree(ROOT/'pairing',skill,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','results','.DS_Store'))
source=skill/'assets/source'
if source.exists():shutil.rmtree(source)
source.mkdir(parents=True)
for name in ['app.js','app.json','package.json','THIRD-PARTY-MUSE.md','LICENSE','lib','pages','assets','legal']:
 src=ROOT/name
 if src.is_dir():shutil.copytree(src,source/name)
 else:shutil.copyfile(src,source/name)
definition=json.loads((ROOT/'app.json').read_text())
agent_id=str(uuid.UUID(definition['agentId'].removeprefix('develop.rokid.agent.')))
(source/'.aix').mkdir()
(source/'.aix/agent-id').write_text(agent_id+'\n')
(source/'tests').mkdir()
for src in (ROOT/'tests').glob('*'):
 if src.suffix in ['.mjs','.json']:shutil.copyfile(src,source/'tests'/src.name)
(source/'AGENTS.md').write_text('Write AIUI source and comments in English. See this Skill’s references/开发与验证.md for development guidance. Never bundle credentials or present transport receipts as Muse replies.\n')
(source/'native-pairing').mkdir()
for name in ['src','build.sh','fetch-deps.py','AndroidManifest.xml','tests']:
 src=ROOT/'native-pairing'/name
 if src.is_dir():shutil.copytree(src,source/'native-pairing'/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc','results','.DS_Store'))
 else:shutil.copyfile(src,source/'native-pairing'/name)
releases=skill/'assets/releases';releases.mkdir(parents=True,exist_ok=True)
shutil.copyfile(ROOT/'native-pairing/build/muse-pairing.apk',releases/'muse-pairing.apk')
shutil.copyfile(ROOT/'scripts/build-phone.cjs',skill/'scripts/build-aix.cjs')
subprocess.run(['node',str(ROOT/'scripts/build-phone.cjs'),str(source),str(releases/'muse-aiui.aix')],check=True)
subprocess.run(['python3',str(skill/'scripts/setup.py'),'--dry-run'],check=True)
print(output)
