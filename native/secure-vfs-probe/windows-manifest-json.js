import { TextDecoder } from 'node:util';
import { validateWindowsManifest } from './windows-role-manifest.js';
import { validateWindowsManifestIntent } from './windows-manifest-lifecycle.js';

export const WINDOWS_MANIFEST_MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 65536;
const decoder = new TextDecoder('utf-8', { fatal: true });

function assertWellFormedUnicode(value, label) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new SyntaxError('Unpaired high surrogate in ' + label);
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new SyntaxError('Unpaired low surrogate in ' + label);
    }
  }
}

function scanUniqueJson(text) {
  let offset = 0;
  let nodes = 0;

  const fail = (reason) => {
    throw new SyntaxError('Invalid strict JSON at offset ' + offset + ': ' + reason);
  };
  const whitespace = () => {
    while (offset < text.length
        && (text[offset] === ' ' || text[offset] === '\t'
          || text[offset] === '\r' || text[offset] === '\n')) offset += 1;
  };
  const string = () => {
    const start = offset;
    if (text[offset] !== '"') fail('expected string');
    offset += 1;
    while (offset < text.length) {
      const char = text[offset];
      if (char === '"') {
        offset += 1;
        let decoded;
        try {
          decoded = JSON.parse(text.slice(start, offset));
        } catch {
          fail('invalid string escape');
        }
        assertWellFormedUnicode(decoded, 'JSON string');
        return decoded;
      }
      if (char.charCodeAt(0) < 0x20) fail('unescaped control character');
      if (char === '\\') {
        offset += 1;
        if (offset >= text.length) fail('truncated escape');
        if (text[offset] === 'u') {
          offset += 1;
          for (let i = 0; i < 4; i += 1) {
            if (!/[0-9a-f]/i.test(text[offset] ?? '')) fail('invalid Unicode escape');
            offset += 1;
          }
          continue;
        }
        if (!'"\\/bfnrt'.includes(text[offset])) fail('invalid escape');
      }
      offset += 1;
    }
    fail('unterminated string');
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) fail('maximum nesting depth exceeded');
    nodes += 1;
    if (nodes > MAX_NODES) fail('maximum token count exceeded');
    whitespace();
    const char = text[offset];
    if (char === '"') {
      string();
      return;
    }
    if (char === '{') {
      offset += 1;
      whitespace();
      const keys = new Set();
      if (text[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail('duplicate object key ' + JSON.stringify(key));
        keys.add(key);
        whitespace();
        if (text[offset] !== ':') fail('expected colon');
        offset += 1;
        value(depth + 1);
        whitespace();
        if (text[offset] === '}') {
          offset += 1;
          return;
        }
        if (text[offset] !== ',') fail('expected comma or object end');
        offset += 1;
      }
      fail('unterminated object');
    }
    if (char === '[') {
      offset += 1;
      whitespace();
      if (text[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        value(depth + 1);
        whitespace();
        if (text[offset] === ']') {
          offset += 1;
          return;
        }
        if (text[offset] !== ',') fail('expected comma or array end');
        offset += 1;
      }
      fail('unterminated array');
    }
    const start = offset;
    while (offset < text.length && !/[,\]} \t\r\n]/.test(text[offset])) offset += 1;
    if (offset === start) fail('expected value');
    // JSON.parse below validates primitive grammar and number syntax.
  };

  whitespace();
  value(0);
  whitespace();
  if (offset !== text.length) fail('trailing content');
}

function decodeBytes(input) {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('Windows manifest input must be a Uint8Array');
  }
  if (input.byteLength === 0 || input.byteLength > WINDOWS_MANIFEST_MAX_BYTES) {
    throw new RangeError('Windows manifest input is empty or exceeds the size limit');
  }
  if (input.byteLength >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    throw new SyntaxError('UTF-8 BOM is not permitted in Windows manifest data');
  }
  let text;
  try {
    text = decoder.decode(input);
  } catch {
    throw new SyntaxError('Windows manifest data is not valid UTF-8');
  }
  scanUniqueJson(text);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SyntaxError('Windows manifest data is not valid JSON');
  }
  return value;
}

export function parseWindowsManifestBytes(input) {
  const manifest = decodeBytes(input);
  validateWindowsManifest(manifest);
  return manifest;
}

export function parseWindowsIntentBytes(input) {
  const intent = decodeBytes(input);
  validateWindowsManifestIntent(intent);
  return intent;
}

export function encodeWindowsManifestBytes(manifest) {
  validateWindowsManifest(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (bytes.byteLength === 0 || bytes.byteLength > WINDOWS_MANIFEST_MAX_BYTES) {
    throw new RangeError('Serialized Windows manifest exceeds the size limit');
  }
  return bytes;
}

export function encodeWindowsIntentBytes(intent) {
  validateWindowsManifestIntent(intent);
  const bytes = Buffer.from(JSON.stringify(intent), 'utf8');
  if (bytes.byteLength === 0 || bytes.byteLength > WINDOWS_MANIFEST_MAX_BYTES) {
    throw new RangeError('Serialized Windows intent exceeds the size limit');
  }
  return bytes;
}
