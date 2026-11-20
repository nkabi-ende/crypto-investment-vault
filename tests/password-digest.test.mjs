import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pbkdf2Sync} from 'node:crypto';
import {build} from 'esbuild';

test('runtime fallback verifies the existing UTF-8 password formats byte for byte',async()=>{
 const {outputFiles}=await build({entryPoints:['src/password-digest.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {derivePassword}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 for(const iterations of [310000,600000]){
  const password='CIV test · 🔐',salt='isolated:test';
  const expected=pbkdf2Sync(password,salt,iterations,32,'sha256');
  const actual=derivePassword(password,salt,iterations,()=>{throw Error('runtime limit')});
  assert.deepEqual(Buffer.from(actual),expected);
 }
});
