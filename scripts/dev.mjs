import {spawnSync,spawn} from 'node:child_process';
const run=args=>{const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status)process.exit(r.status);};
run(['scripts/build.mjs']);run(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local']);
const args=process.argv.slice(2),at=args.indexOf('--port');const port=at>=0?args[at+1]:(process.env.PORT??'4173');
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--ip','0.0.0.0','--port',port],{stdio:'inherit'});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));
child.on('exit',code=>process.exit(code??0));
