// Read-only validation. Produces diagnostics on stdout, never output files.
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(path){const entries=await readdir(path,{withFileTypes:true});return(await Promise.all(entries.filter(e=>!e.name.startsWith('.')&&!['target','node_modules'].includes(e.name)&&!(e.name==='data'&&path.endsWith('/server'))).map(e=>e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)]))).flat();}
const files=await walk(root);let failed=false,count=0;
for(const file of files){
  if(file.endsWith('.json')){try{JSON.parse(await readFile(file,'utf8'));count++;}catch(error){console.error(file,error.message);failed=true;}}
  if(/\.(mjs|js)$/.test(file)){const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(check.status!==0){console.error(check.stderr);failed=true;}else count++;}
}
console.log(`${count} JavaScript modules and JSON documents parsed.`);process.exitCode=failed?1:0;
