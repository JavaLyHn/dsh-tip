import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const bridgeUrl = new URL('../lib/taskbar-bridge.js', import.meta.url);
const bridge = existsSync(bridgeUrl) ? await import('../lib/taskbar-bridge.js') : null;

function requireBridge() {
  assert.ok(bridge, 'taskbar bridge module is missing');
  return bridge;
}

const completed = {
  type: 'turn/end',
  seq: 3,
  time: 300,
  data: { reason: { kind: 'completed' } },
};

function supportedTransport(messages) {
  return {
    capability: '1',
    platform: 'win32',
    connected: true,
    send(message) {
      messages.push(message);
    },
  };
}

test('only taskbar and both request a badge', () => {
  const { shouldNotifyTaskbar } = requireBridge();
  for (const mode of ['off', 'popup']) assert.equal(shouldNotifyTaskbar(mode, completed), false);
  for (const mode of ['taskbar', 'both']) assert.equal(shouldNotifyTaskbar(mode, completed), true);
  assert.equal(
    shouldNotifyTaskbar('both', { ...completed, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }),
    false,
  );
});

test('supported transport sends boolean-only payload', () => {
  const { postTaskbarBadge } = requireBridge();
  const messages = [];

  const sent = postTaskbarBadge(supportedTransport(messages), true);

  assert.equal(sent, true);
  assert.deepEqual(messages, [{ type: 'dsh-taskbar-badge', enabled: true }]);
});

test('unsupported transport sends nothing', () => {
  const { postTaskbarBadge } = requireBridge();
  const messages = [];
  const supported = supportedTransport(messages);
  const unsupported = [
    { ...supported, capability: undefined },
    { ...supported, capability: '0' },
    { ...supported, platform: 'linux' },
    { ...supported, connected: false },
    { ...supported, send: undefined },
  ];

  for (const transport of unsupported) {
    assert.equal(postTaskbarBadge(transport, true), false);
  }
  assert.deepEqual(messages, []);
});

test('taskbar event listener gates events and clears on cleanup', () => {
  const { registerTaskbarEvents } = requireBridge();
  assert.equal(typeof registerTaskbarEvents, 'function', 'taskbar event lifecycle helper is missing');
  const messages = [];
  let listener;
  let cleanup;
  let disposed = false;
  const ctx = {
    effect(effect) {
      cleanup = effect();
    },
    on(name, handler) {
      assert.equal(name, 'session/event');
      listener = handler;
      return () => { disposed = true; };
    },
  };

  registerTaskbarEvents(ctx, 'both', () => supportedTransport(messages));
  listener({ id: 'session-1' }, completed);
  listener({ id: 'session-1' }, {
    ...completed,
    data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
  });
  assert.deepEqual(messages, [{ type: 'dsh-taskbar-badge', enabled: true }]);

  cleanup();

  assert.equal(disposed, true);
  assert.deepEqual(messages, [
    { type: 'dsh-taskbar-badge', enabled: true },
    { type: 'dsh-taskbar-badge', enabled: false },
  ]);
});

test('postTaskbarBadge can clear by sending false', () => {
  const { postTaskbarBadge } = requireBridge();
  const messages = [];

  assert.equal(postTaskbarBadge(supportedTransport(messages), false), true);
  assert.deepEqual(messages, [{ type: 'dsh-taskbar-badge', enabled: false }]);
});
