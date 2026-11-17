import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('secret scanner detects synthetic keys and email without emitting credential contents',()=>{
 const script="import importlib.util; s=importlib.util.spec_from_file_location('scan','scripts/scan_secrets.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); values=[b'sk-'+b'fuyao-'+b'x'*24,b'Bearer '+b'z'*40,b'test'+b'@'+b'example.com']; print([m.hits(v) for v in values])";
 const output=execFileSync('python3',['-c',script],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.match(output,/fuyao_key/);assert.match(output,/literal_bearer/);assert.match(output,/email/);assert(!output.includes('xxxxxxxx'));
});
test('delivery source, built Worker and reachable Git history contain no recognized secrets or emails',()=>{
 const output=execFileSync('python3',['scripts/scan_secrets.py'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});const report=JSON.parse(output);assert.equal(report.findings.length,0);assert(report.historyBlobsScanned>0);assert(report.filesScanned>0);
});
