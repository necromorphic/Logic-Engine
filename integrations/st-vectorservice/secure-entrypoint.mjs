import { pathToFileURL } from 'node:url';

// The bootstrap validates and pins this exact server.js path, resolves its
// better-sqlite3 package, and registers the VFS before the service is loaded.
import { serverEntryPath } from './logic-engine-vfs-bootstrap.mjs';

await import(pathToFileURL(serverEntryPath).href);
