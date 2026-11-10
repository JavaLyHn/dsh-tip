import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJson = async (path) => JSON.parse(await readText(path));

const requiredFiles = [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'lib/*.js',
  'locale/*.json',
  'icon.svg',
  'README.md',
  'patches/dsh-v0.2.2-rc.1.patch',
];

test('bundle has complete runtime exports and files', async () => {
  const manifest = await readJson('../package.json');
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json');
  assert.equal(manifest.exports['./icon'], './icon.svg');

  for (const file of requiredFiles) {
    assert.ok(manifest.files.includes(file), `package files must include ${file}`);
  }
  assert.ok(!manifest.files.some((file) => file.startsWith('docs/')), 'internal process docs must not be packaged');
  for (const file of ['../README.md', '../patches/dsh-v0.2.2-rc.1.patch']) {
    assert.ok((await readText(file)).length > 0, `${file} must exist and be non-empty`);
  }

  const readme = await readText('../README.md');
  assert.match(readme, /pnpm install --ignore-scripts/u);
  assert.match(readme, /dsh plugin --profile YOUR_PROFILE add \./u);
  assert.match(readme, /## Modes/u);
  assert.doesNotMatch(readme, /docs\//u);
});

test('metadata, defaults, and dependencies match the package contract', async () => {
  const manifest = await readJson('../package.json');
  assert.equal(manifest.name, '@local/dsh-tip-completion-notice');
  assert.equal(manifest.private, true);
  assert.equal(manifest.packageManager, 'pnpm@11.28.5');
  assert.deepEqual(manifest.dependencies, { '@deepseek-ai/schemastery': '3.19.0' });
  assert.deepEqual(manifest.peerDependencies, { zod: '4.4.3' });
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation']);

  const patch = await readText('../cordis.patch.yml');
  assert.match(patch, /id:\s*dsh-tip-completion-notice/u);
  assert.match(patch, /config:\s*\n\s*mode:\s*both/u);
  const host = await readText('../index.js');
  assert.match(host, /const MODES = \['off', 'popup', 'taskbar', 'both'\]/u);
  assert.match(host, /mode: Schema\.union\(MODES\.map\(\(mode\) => Schema\.const\(mode\)\)\)\.default\('both'\)/u);

  const english = await readJson('../locale/en.json');
  const chinese = await readJson('../locale/zh.json');
  assert.equal(english.meta.title, 'Answer completion notice');
  assert.ok(english.meta.description.length > 0);
  assert.equal(chinese.meta.title, '回答完成提醒');
  assert.ok(chinese.meta.description.length > 0);
  assert.ok(manifest.files.includes('locale/*.json'));
  assert.ok(manifest.exports['./locale/*.json']);
  assert.ok(manifest.files.includes('icon.svg'));
  assert.equal(manifest.exports['./icon'], './icon.svg');
  const icon = await readText('../icon.svg');
  assert.match(icon, /^<svg\s/u);
  assert.match(icon, /<path\b/u);
  assert.match(icon, /<\/svg>\s*$/u);
});

test('host entry loads and exports a native Config schema', async () => {
  const host = await import('../index.js');
  assert.equal(typeof host.apply, 'function');
  assert.equal(host.Config[Symbol.for('schemastery')], true);
  assert.equal(typeof host.Config.type, 'string');
  assert.equal(typeof host.Config.meta, 'object');
});
