import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const broker = readFileSync(
  new URL('../deploy/sqlite-security/logic-engine-sqlite-broker.service', import.meta.url),
  'utf8',
);
const app = readFileSync(
  new URL('../deploy/sqlite-security/logic-engine.service', import.meta.url),
  'utf8',
);

function section(source, name) {
  const marker = '[' + name + ']';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'missing systemd [' + name + '] section');
  const body = source.slice(start + marker.length);
  const next = body.indexOf('\\n[');
  return next === -1 ? body : body.slice(0, next);
}

test('POSIX broker runs under a distinct service UID and the application socket group', () => {
  const unit = section(broker, 'Service');
  assert.match(unit, /^User=logic-engine-broker$/m);
  assert.match(unit, /^Group=logic-engine-app$/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/logic-engine\/sqlite-broker\.env$/m);
  assert.match(unit, /^StateDirectory=logic-engine-broker\/manifest logic-engine-broker\/anchor$/m);
  assert.match(unit, /^RuntimeDirectory=logic-engine-sqlite-broker$/m);
  assert.match(unit, /^RuntimeDirectoryMode=0710$/m);
  assert.match(unit, /broker_daemon\.py .*--app-uid=\$\{LOGIC_ENGINE_APP_UID\} --app-gid=\$\{LOGIC_ENGINE_APP_GID\}/);
  assert.match(unit, /^NoNewPrivileges=yes$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
});

test('application starts only after broker reconciliation and cannot mutate alias namespace', () => {
  const unit = section(app, 'Unit');
  const service = section(app, 'Service');
  assert.match(unit, /^After=.*logic-engine-sqlite-broker\.service$/m);
  assert.match(unit, /^Requires=logic-engine-sqlite-broker\.service$/m);
  assert.match(service, /^User=logic-engine-app$/m);
  assert.match(service, /^Group=logic-engine-app$/m);
  assert.doesNotMatch(service, /^DynamicUser=/m);
  assert.match(service, /^EnvironmentFile=\/etc\/logic-engine\/sqlite-broker\.env$/m);
  assert.doesNotMatch(service, /^ReadWritePaths=.*logic-engine-sqlite-alias/m);
  assert.match(service, /^NoNewPrivileges=yes$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
});
