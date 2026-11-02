import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// This import must complete before server.js evaluates its better-sqlite3
// constructor. The bootstrap registers the secure VFS in the same SQLite
// library instance that server.js will resolve from its own module location.
import './logic-engine-vfs-bootstrap.mjs';

const serverEntry = process.env.LOGIC_ENGINE_ST_VECTOR_SERVER_ENTRY;
if (!serverEntry || !path.isAbsolute(serverEntry)) {
  throw new Error('LOGIC_ENGINE_ST_VECTOR_SERVER_ENTRY must be the absolute installed ST-VectorService server.js path');
}
const serverInfo = fs.statSync(serverEntry);
if (!serverInfo.isFile() || path.basename(serverEntry).toLowerCase() !== 'server.js') {
  throw new Error('LOGIC_ENGINE_ST_VECTOR_SERVER_ENTRY must identify the installed server.js file');
}

await import(pathToFileURL(serverEntry).href);
