import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SQLiteStore } from './storage/sqlite-store.js';
import { LogicEngine } from './application/engine.js';
import { createApiServer } from './api/server.js';
const token=process.env.ENGINE_API_TOKEN;
if(!token||token.length<16){process.stderr.write('ENGINE_API_TOKEN must be set and at least 16 characters long.\n');process.exit(1);}
const dbPath=process.env.ENGINE_DB_PATH||'./data/logic-engine.sqlite';
if(dbPath!==':memory:')mkdirSync(dirname(resolve(dbPath)),{recursive:true});
const port=Number(process.env.ENGINE_PORT||8787),host=process.env.ENGINE_HOST||'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('ENGINE_PORT must be between 1 and 65535.');
if(!['127.0.0.1','::1','localhost'].includes(host)&&process.env.ENGINE_ALLOW_REMOTE!=='true')throw new Error('Remote binding is disabled unless ENGINE_ALLOW_REMOTE=true.');
const store=new SQLiteStore(dbPath),server=createApiServer({engine:new LogicEngine(store),token});
server.listen(port,host,()=>process.stdout.write('Logic-Engine API listening on http://'+host+':'+port+'\nDatabase: '+dbPath+'\n'));
function stop(){server.close(()=>{store.close();process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);