import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const projectionUrl = new URL('../lib/completion-projection.js', import.meta.url);
const projection = existsSync(projectionUrl)
  ? await import('../lib/completion-projection.js')
  : null;

function requireProjection() {
  assert.ok(projection, 'completion projection module is missing');
  return projection;
}

const endReasons = [
  'aborted',
  'blocked',
  'error',
  'max-tokens',
  'interrupted',
  'forked',
];

test('only completed turn/end advances marker', () => {
  const { reduceCompletion } = requireProjection();
  const state = {
    pendingPrompt: 'Draft the report',
    lastCompletion: { seq: 8, time: 800, fallbackLabel: 'Earlier task' },
  };
  const event = {
    type: 'turn/end',
    seq: 9,
    time: 900,
    data: { reason: { kind: 'completed' } },
  };

  const next = reduceCompletion(state, event);

  assert.deepEqual(next.lastCompletion, {
    seq: 9,
    time: 900,
    fallbackLabel: 'Draft the report',
  });
  assert.equal(next.pendingPrompt, null);
});

test('other end reasons preserve state', () => {
  const { reduceCompletion } = requireProjection();
  const state = {
    pendingPrompt: 'Do not announce this',
    lastCompletion: { seq: 2, time: 200, fallbackLabel: null },
  };

  for (const reason of endReasons) {
    const next = reduceCompletion(state, {
      type: 'turn/end',
      seq: 3,
      time: 300,
      data: { reason: reason === 'aborted' ? { kind: reason, reason: { kind: 'user' } } : { kind: reason } },
    });
    assert.strictEqual(next, state, `${reason} must not change projection state`);
  }
});

test('user message stores only sanitized text blocks', () => {
  const { reduceCompletion } = requireProjection();
  const state = { pendingPrompt: null, lastCompletion: null };
  const next = reduceCompletion(state, {
    type: 'user/message',
    seq: 4,
    time: 400,
    data: {
      id: 'message-4',
      role: 'user',
      content: [
        { type: 'text', text: 'Review this' },
        { type: 'image', attachment: { name: 'private.png' } },
        { type: 'text', text: 'carefully' },
      ],
    },
  });

  assert.equal(next.pendingPrompt, 'Review this carefully');
  assert.equal(next.lastCompletion, null);
});

test('prompt summary is one-line, control-free, and 80-code-point bounded', () => {
  const { sanitizePromptSummary } = requireProjection();
  const input = `  Review\r\nthis\t\u0000\u007f ${'🧭'.repeat(100)}  `;

  const summary = sanitizePromptSummary(input);

  assert.equal(Array.from(summary).length, 80);
  assert.equal(/[\r\n\u0000-\u001f\u007f-\u009f]/u.test(summary), false);
  assert.equal(summary.includes('\n'), false);
});

test('wire view reuses reference when completion is unchanged', () => {
  const { createCompletionView } = requireProjection();
  assert.equal(typeof createCompletionView, 'function', 'stable completion view factory is missing');
  const view = createCompletionView('both');
  const completion = { seq: 7, time: 700, fallbackLabel: 'Review report' };

  const first = view({ pendingPrompt: null, lastCompletion: completion });
  const afterPrompt = view({ pendingPrompt: 'A later request', lastCompletion: completion });
  const afterCompletion = view({ pendingPrompt: null, lastCompletion: { ...completion, seq: 8, time: 800 } });

  assert.strictEqual(afterPrompt, first);
  assert.deepEqual(first, { mode: 'both', lastCompletion: completion });
  assert.notStrictEqual(afterCompletion, first);
});
