#!/usr/bin/env node
// Keep agent.json identity stable; VERSION must change for runtime extraction.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=path.resolve(process.argv[2]||path.join(__dirname,'../assets/source'));
const output=path.resolve(process.argv[3]||path.join(__dirname,'../assets/releases/muse-aiui.aix'));
const cli=(process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,'aix')).find(p=>fs.existsSync(p));
if(!cli)throw new Error('请安装 @yodaos-pkg/aix-cli@0.10.1');
const engine=require(path.join(path.dirname(fs.realpathSync(cli)),'pkg/aix_web.js'));
const id=fs.readFileSync(path.join(source,'.aix/agent-id'),'utf8').trim();
if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('invalid stable application ID');
const builder=new engine.AixSourcePackBuilderWasm();
function add(relative){const full=path.join(source,relative);if(fs.statSync(full).isDirectory()){for(const name of fs.readdirSync(full))add(relative+'/'+name);}else builder.add_file(relative,new Uint8Array(fs.readFileSync(full)));}
for(const item of ['app.js','app.json','assets','lib','pages','legal','LICENSE','THIRD-PARTY-MUSE.md'])add(item);
const buildId=crypto.randomUUID();
const result=builder.pack_from_source_with_progress(buildId,undefined,null,()=>{});
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result.data);
const reader=new engine.AixReaderWasm(new Uint8Array(result.data));
if(new TextDecoder().decode(reader.read_file('VERSION')).trim()!==buildId)throw new Error('build version not preserved');
const app=JSON.parse(fs.readFileSync(path.join(source,'app.json'),'utf8'));
const definition={schemaVersion:1,agentId:'develop.rokid.agent.'+id,agentName:app.agentName,agentDesc:app.agentDesc,nativeVersion:app.nativeVersion,inkVersion:app.inkVersion,permissions:app.permissions,agentPrompt:'',agentLogo:''};
fs.writeFileSync(path.join(path.dirname(output),'agent.json'),JSON.stringify(definition,null,2)+'\n');
const manifestPath=path.join(path.dirname(output),'manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
manifest.version='0.3.1';manifest.agent_id=definition.agentId;manifest.build_id=buildId;manifest.sha256={};
for(const name of ['muse-aiui.aix','muse-pairing.apk','agent.json']){const file=path.join(path.dirname(output),name);if(fs.existsSync(file))manifest.sha256[name]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log('固定应用 ID：'+definition.agentId+'；本次代码版本：'+buildId);
