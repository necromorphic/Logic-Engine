import { constants as fsConstants, openSync, readSync } from 'node:fs';
import { EngineError } from '../core/errors.js';

export const MAX_TRUSTED_IMPORT_BYTES = 1_000_000;
const READ_CHUNK_BYTES = 64 * 1024;

export function openTrustedImportDescriptor(path, noFollowFlag) {
  const nonBlocking = Number.isInteger(fsConstants.O_NONBLOCK) ? fsConstants.O_NONBLOCK : 0;
  const noFollow = Number.isInteger(noFollowFlag) && noFollowFlag !== 0 ? noFollowFlag : 0;
  return openSync(path, fsConstants.O_RDONLY | nonBlocking | noFollow);
}

export function readBoundedFileDescriptor(fd) {
  const chunks = [];
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  let total = 0;

  while (total <= MAX_TRUSTED_IMPORT_BYTES) {
    const remaining = MAX_TRUSTED_IMPORT_BYTES + 1 - total;
    const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
    if (bytesRead === 0) break;

    total += bytesRead;
    if (total > MAX_TRUSTED_IMPORT_BYTES) {
      throw new EngineError(
        'INVALID_TRUSTED_IMPORT_FILE',
        'Trusted import bytes must remain within the 1 MiB limit when read.',
      );
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }

  if (total === 0) {
    throw new EngineError('INVALID_TRUSTED_IMPORT_FILE', 'Trusted import file must not be empty.');
  }
  return Buffer.concat(chunks, total);
}
