import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../native/windows-namespace-broker/windows_broker_service.c',import.meta.url),'utf8');
const docs=await readFile(new URL('../native/windows-namespace-broker/README.md',import.meta.url),'utf8');
test('Windows broker authenticates local pipe clients by configured SID',()=>{
 assert.match(source,/ImpersonateNamedPipeClient/);assert.match(source,/OpenThreadToken/);
 assert.match(source,/EqualSid\\(u->User\\.Sid,allowed_sid\\)/);
 assert.match(source,/PIPE_REJECT_REMOTE_CLIENTS/);
});
test('Windows broker keeps filesystem operations disabled without backend',()=>{
 assert.match(source,/q\\.operation>=2&&q\\.operation<=8\\)r\\.flags=3/);
 assert.match(docs,/Only PING is implemented/);assert.match(docs,/Do not connect the SQLite VFS/);
});
