import test from 'node:test';
import assert from 'node:assert/strict';

const previousWindow = globalThis.window;
let loadedBundle;
globalThis.window = {
  __ModuleLoader__: {
    load(bundle) {
      loadedBundle = bundle;
    },
  },
};
await import('../client.js');
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
assert.ok(loadedBundle, 'Client bundle entry did not register with ModuleLoader');

const PROJECTION_KEY = 'dsh-tip/completion-notice';
const LOCALE_NAMESPACE = 'dsh-tip-completion-notice';

function completion(seq, time, fallbackLabel = null) {
  return { seq, time, fallbackLabel };
}

function summary(id, mode, lastCompletion, title) {
  return {
    id,
    displayTitle: title || id,
    ...(title === undefined ? {} : { title }),
    projectionValues: {
      [PROJECTION_KEY]: { mode, lastCompletion },
    },
  };
}

function snapshot(rows, phase = 'ready') {
  return {
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    phase,
    projectionsBySession: {},
  };
}

function statusesFor(rows) {
  return new Map(rows.map((row) => [row.id, {
    running: false,
    pendingInteraction: null,
    completionUnread: false,
  }]));
}

function createFakeReact() {
  let renderer;
  const React = {
    createElement(type, props, ...children) {
      const normalizedChildren = children.length === 0
        ? props?.children
        : children.length === 1
          ? children[0]
          : children;
      return { type, props: { ...(props ?? {}), children: normalizedChildren } };
    },
    useState(initial) {
      assert.ok(renderer, 'React hook called outside a render');
      return renderer.useState(initial);
    },
    useEffect(effect, dependencies) {
      assert.ok(renderer, 'React hook called outside a render');
      return renderer.useEffect(effect, dependencies);
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const [value, setValue] = React.useState(getSnapshot);
      React.useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe, getSnapshot]);
      return value;
    },
  };

  function createRenderer(component, props) {
    const slots = [];
    let hookIndex = 0;
    let pendingEffects = [];
    let needsRender = false;
    let mounted = true;
    let tree = null;

    renderer = {
      useState(initial) {
        const index = hookIndex++;
        let slot = slots[index];
        if (slot === undefined) {
          slot = {
            kind: 'state',
            value: typeof initial === 'function' ? initial() : initial,
          };
          slots[index] = slot;
        }
        assert.equal(slot.kind, 'state', `hook ${index} changed kind`);
        const setValue = (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (!Object.is(value, slot.value)) {
            slot.value = value;
            needsRender = true;
          }
        };
        return [slot.value, setValue];
      },
      useEffect(effect, dependencies) {
        const index = hookIndex++;
        const old = slots[index];
        if (old !== undefined) assert.equal(old.kind, 'effect', `hook ${index} changed kind`);
        const changed = old === undefined
          || dependencies === undefined
          || old.dependencies === undefined
          || dependencies.length !== old.dependencies.length
          || dependencies.some((value, position) => !Object.is(value, old.dependencies[position]));
        if (changed) pendingEffects.push({ index, effect, dependencies });
      },
      render() {
        if (!mounted) return null;
        let passes = 0;
        do {
          needsRender = false;
          hookIndex = 0;
          pendingEffects = [];
          tree = component(props);
          const effects = pendingEffects;
          pendingEffects = [];
          for (const pending of effects) {
            const previous = slots[pending.index];
            if (previous?.kind === 'effect') previous.cleanup?.();
            const cleanup = pending.effect();
            slots[pending.index] = {
              kind: 'effect',
              dependencies: pending.dependencies,
              cleanup,
            };
          }
          passes += 1;
          assert.ok(passes <= 20, 'fake React exceeded the render limit');
        } while (needsRender);
        return tree;
      },
      unmount() {
        if (!mounted) return;
        mounted = false;
        for (const slot of [...slots].reverse()) {
          if (slot?.kind === 'effect') slot.cleanup?.();
        }
      },
    };
    return renderer;
  }

  return { React, createRenderer };
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node);
  walk(node.props?.children, visit);
}

function findAll(tree, predicate) {
  const result = [];
  walk(tree, (node) => {
    if (predicate(node)) result.push(node);
  });
  return result;
}

function textContent(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  return textContent(tree.props?.children);
}

async function createHarness(initialRows, initialPhase = 'ready') {
  let nextTimerId = 1;
  const timers = new Map();
  const listeners = new Set();
  const dictionaries = new Map();
  const registrations = [];
  const contextCleanups = [];
  const navigationCalls = [];
  const sessionUsingCalls = [];
  const submissionCalls = [];
  const promptCalls = [];
  const abandonedSubmissions = [];
  let promptResult = { ok: true, value: { accepted: true } };
  let promptFailure = null;
  let nextRequestId = 1;
  let localeSnapshot = { active: 'en', revision: 0 };
  let slotName;
  let slotRegistration;
  let component;
  let focusCalls = 0;
  let sessionSnapshot = snapshot(initialRows, initialPhase);
  let statusSnapshot = statusesFor(initialRows);
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    focus: globalThis.focus,
  };
  const fakeWindow = {
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  globalThis.window = fakeWindow;
  globalThis.document = {
    activeElement: { focus() { focusCalls += 1; } },
    querySelector() { return { focus() { focusCalls += 1; } }; },
    getElementById() { return { focus() { focusCalls += 1; } }; },
  };
  globalThis.focus = () => { focusCalls += 1; };

  const locale = {
    register(namespace, values) {
      registrations.push({ namespace, values });
      dictionaries.set(namespace, values);
      return () => dictionaries.delete(namespace);
    },
    bind(namespace) {
      return (key) => {
        const values = dictionaries.get(namespace);
        return values?.[localeSnapshot.active]?.[key]
          ?? values?.en?.[key]
          ?? key;
      };
    },
    getSnapshot() {
      return localeSnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocale(active) {
      localeSnapshot = { active, revision: localeSnapshot.revision + 1 };
      for (const listener of listeners) listener();
    },
  };

  const { React, createRenderer } = createFakeReact();
  const plugin = loadedBundle.factory((name) => {
    assert.equal(name, 'react', `unexpected Client runtime import: ${name}`);
    return React;
  });
  const uiWorkspace = {
    openSession(target) {
      navigationCalls.push(target);
    },
  };
  const sessionsService = {
    async using(target, options, operation) {
      sessionUsingCalls.push({ target, options });
      const session = {
        beginSubmission(input) {
          const requestId = `request-${nextRequestId++}`;
          submissionCalls.push({ target, input, requestId });
          return {
            requestId,
            abandon() {
              abandonedSubmissions.push(requestId);
            },
          };
        },
        async prompt(content, mode, signal, requestId) {
          promptCalls.push({ target, content, mode, signal, requestId });
          if (promptFailure) throw promptFailure;
          return promptResult;
        },
      };
      const binding = { session };
      return operation({ binding, ready: Promise.resolve(binding) });
    },
  };
  const ctx = {
    locale,
    uiWorkspace,
    sessions: sessionsService,
    effect(effect) {
      const cleanup = effect();
      if (typeof cleanup === 'function') contextCleanups.push(cleanup);
      return () => cleanup?.();
    },
    slots: {
      inject(name, callback) {
        slotName = name;
        const cleanup = callback();
        if (typeof cleanup === 'function') contextCleanups.push(cleanup);
        return () => cleanup?.();
      },
      register(options, registeredComponent) {
        slotRegistration = options;
        component = registeredComponent;
        return () => {
          if (component === registeredComponent) component = undefined;
        };
      },
    },
  };
  await plugin.apply(ctx);

  const renderProps = {
    useSessions: (selector) => {
      assert.equal(typeof selector, 'function', 'useSessions requires a selector');
      return selector(sessionSnapshot);
    },
    useSessionStatus: (selector) => {
      assert.equal(typeof selector, 'function', 'useSessionStatus requires a selector');
      return selector(statusSnapshot);
    },
  };
  const renderer = component ? createRenderer(component, renderProps) : null;

  return {
    get component() { return component; },
    get slotName() { return slotName; },
    get registration() { return slotRegistration; },
    get injects() { return plugin.inject; },
    get tree() { return renderer?.render() ?? null; },
    timers,
    registrations,
    navigationCalls,
    sessionUsingCalls,
    submissionCalls,
    promptCalls,
    abandonedSubmissions,
    locale,
    setPromptResult(result) { promptResult = result; },
    setPromptFailure(error) { promptFailure = error; },
    get focusCalls() { return focusCalls; },
    render() { return renderer?.render() ?? null; },
    setSnapshot(rows, statuses = undefined, phase = 'ready') {
      sessionSnapshot = snapshot(rows, phase);
      statusSnapshot = statuses ?? statusesFor(rows);
      return renderer?.render() ?? null;
    },
    setStatuses(statuses) {
      statusSnapshot = statuses;
      return renderer?.render() ?? null;
    },
    runNextTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'no timer is scheduled');
      const [id, timer] = entry;
      timers.delete(id);
      timer.callback();
      renderer?.render();
    },
    dispose() {
      renderer?.unmount();
      for (const cleanup of contextCleanups.reverse()) cleanup();
      if (previousGlobals.window === undefined) delete globalThis.window;
      else globalThis.window = previousGlobals.window;
      if (previousGlobals.document === undefined) delete globalThis.document;
      else globalThis.document = previousGlobals.document;
      if (previousGlobals.focus === undefined) delete globalThis.focus;
      else globalThis.focus = previousGlobals.focus;
    },
  };
}

function assertOverlay(harness) {
  assert.equal(harness.slotName, 'shell.overlay', 'toast is not registered in the global overlay');
  assert.equal(typeof harness.component, 'function', 'overlay component is missing');
  assert.equal(harness.registration?.id, 'dsh-tip-completion-notice');
  assert.ok(harness.injects.includes('uiWorkspace'), 'session navigation service is not injected');
  assert.ok(harness.injects.includes('sessions'), 'session submission service is not injected');
}

function statusNode(harness) {
  return findAll(harness.tree, (node) => node.props?.role === 'status')[0] ?? null;
}

function toastNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className?.startsWith('dsh-tip-card'))[0] ?? null;
}

function actionButtonNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className === 'dsh-tip-toast__header')[0] ?? null;
}

function composerNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className === 'dsh-tip-composer')[0] ?? null;
}

function inputNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className === 'dsh-tip-composer__input')[0] ?? null;
}

function sendButtonNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className === 'dsh-tip-composer__send')[0] ?? null;
}

function frameNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className === 'dsh-tip-frame')[0] ?? null;
}

function styleNode(harness) {
  return findAll(harness.tree, (node) => node.type === 'style')[0] ?? null;
}

test('initial snapshot does not replay', async () => {
  const row = summary('session-a', 'both', completion(4, 400, 'Old prompt'), 'Existing title');
  const harness = await createHarness([row]);
  try {
    assertOverlay(harness);
    harness.render();
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);
  } finally {
    harness.dispose();
  }
});

test('a pending session list does not establish the baseline', async () => {
  const oldCompletion = summary('session-old', 'popup', completion(4, 400, 'Old prompt'), 'Old session');
  const harness = await createHarness([], 'pending');
  try {
    assertOverlay(harness);
    harness.render();
    assert.equal(statusNode(harness), null);

    harness.setSnapshot([oldCompletion]);
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);
  } finally {
    harness.dispose();
  }
});

test('a session in the baseline does not replay when its projection arrives later', async () => {
  const initial = { id: 'session-a', title: 'Existing title', projectionValues: {} };
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    const updated = summary('session-a', 'popup', completion(4, 400, 'Old prompt'), 'Existing title');
    harness.setSnapshot([updated]);
    assert.equal(statusNode(harness), null);
  } finally {
    harness.dispose();
  }
});

test('a new session completion after the baseline is announced', async () => {
  const harness = await createHarness([]);
  try {
    assertOverlay(harness);
    harness.render();
    assert.equal(statusNode(harness), null);

    const row = summary('session-new', 'popup', completion(1, 100, 'Fresh prompt'), 'New session');
    harness.setSnapshot([row]);
    assert.match(textContent(statusNode(harness)), /Answer complete/u);
    assert.doesNotMatch(textContent(statusNode(harness)), /New session|Fresh prompt/u);
  } finally {
    harness.dispose();
  }
});

test('completion cue adds theme-colored glow while respecting motion preferences', async () => {
  const harness = await createHarness([]);
  try {
    harness.render();
    harness.setSnapshot([
      summary('session-new', 'popup', completion(1, 100, 'Fresh prompt'), 'New session'),
    ]);

    const toast = toastNode(harness);
    const button = actionButtonNode(harness);
    assert.ok(toast, 'completion toast is missing');
    assert.ok(button, 'completion action button is missing');
    assert.equal(statusNode(harness)?.props?.['aria-live'], 'polite');
    assert.equal(statusNode(harness)?.props?.['aria-atomic'], 'true');
    assert.equal(button.type, 'button');
    assert.equal(button.props['aria-label'], 'Open the completed conversation');
    assert.equal(button.props['aria-expanded'], false);
    assert.match(textContent(button), /Answer complete/u);
    assert.doesNotMatch(textContent(button), /click to open|→/iu);
    assert.equal(composerNode(harness), null, 'composer remains hidden until expansion');
    assert.equal(frameNode(harness)?.props?.['aria-hidden'], true);

    const css = textContent(styleNode(harness));
    assert.match(css, /top:\s*64px/u);
    assert.match(css, /left:\s*50%/u);
    assert.match(css, /transform:\s*translateX\(-50%\)/u);
    assert.match(css, /max-width:\s*min\(410px, calc\(100vw - 28px\)\)/u);
    assert.match(css, /pointer-events:\s*none/u);
    assert.match(css, /pointer-events:\s*auto/u);
    assert.match(css, /dsh-tip-frame-pulse 1\.25s ease-in-out 2/u);
    assert.match(css, /dsh-tip-frame-chroma 2\.5s ease-in-out/u);
    assert.match(css, /dsh-tip-toast-enter 180ms ease-out/u);
    assert.match(css, /dsh-tip-toast-glow 2\.4s ease-in-out/u);
    assert.match(css, /dsh-tip-check-glow 2\.4s ease-in-out/u);
    assert.doesNotMatch(css, /dsh-tip-toast-life|dsh-tip-toast__arrow/u);
    assert.match(css, /-webkit-line-clamp:\s*2/u);
    assert.match(css, /background:\s*color-mix\(in srgb, var\(--dsw-alias-bg-overlay\) 94%, transparent\)/u);
    assert.doesNotMatch(css, /backdrop-filter/u);
    assert.match(css, /:focus-visible/u);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
    assert.match(css, /--dsw-alias-brand-primary/u);
    assert.match(css, /--dsw-alias-state-error-primary/u);
    assert.match(css, /--dsw-alias-state-success-primary/u);
    assert.match(css, /--dsw-alias-state-warn-primary/u);
    assert.match(css, /hue-rotate\(/u);
    assert.match(css, /filter: none/u);
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/iu);
  } finally {
    harness.dispose();
  }
});

test('clicking the notice body opens its completed session and dismisses the cue', async () => {
  const initial = [
    summary('session-a', 'popup', completion(1, 100, 'Old A'), 'Session A'),
    summary('session-b', 'popup', completion(1, 110, 'Old B'), 'Session B'),
  ];
  const harness = await createHarness(initial);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([
      summary('session-a', 'popup', completion(2, 200, 'New A'), 'Session A'),
      summary('session-b', 'popup', completion(1, 110, 'Old B'), 'Session B'),
    ]);

    const card = toastNode(harness);
    assert.ok(card);
    card.props.onClick({
      target: { closest: () => null },
      nativeEvent: { pointerType: 'mouse' },
    });
    assert.deepEqual(harness.navigationCalls, ['session-a']);

    harness.render();
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.focusCalls, 0, 'navigation must not steal focus before user activation');
  } finally {
    harness.dispose();
  }
});

test('only popup/both render', async () => {
  for (const mode of ['off', 'taskbar', 'popup', 'both']) {
    const initial = summary('session-a', mode, completion(1, 100, 'First task'), 'Session title');
    const harness = await createHarness([initial]);
    try {
      assertOverlay(harness);
      harness.render();
      const updated = summary('session-a', mode, completion(2, 200, 'Next task'), 'Session title');
      harness.setSnapshot([updated]);
      assert.equal(statusNode(harness) !== null, mode === 'popup' || mode === 'both', mode);
    } finally {
      harness.dispose();
    }
  }
});

test('a changed completion waits for its session status snapshot', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'First task'), 'Session title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    const updated = summary('session-a', 'popup', completion(2, 200, 'Next task'), 'Session title');
    harness.setSnapshot([updated], new Map());
    assert.equal(statusNode(harness), null);

    harness.setStatuses(statusesFor([updated]));
    assert.ok(statusNode(harness), 'the deferred completion should appear when status arrives');
  } finally {
    harness.dispose();
  }
});

test('session title and bounded request preview appear only while expanded', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier prompt'), 'Earlier title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    const hostileTitle = `Private project\r\nnotes\t\u0000${'🧭'.repeat(100)}`;
    const sensitivePrompt = `Sensitive prompt\r\nbody\t\u0000${'🗝️'.repeat(100)}`;
    harness.setSnapshot([
      summary('session-a', 'popup', completion(2, 200, sensitivePrompt), hostileTitle),
    ]);

    const button = actionButtonNode(harness);
    assert.match(textContent(statusNode(harness)), /Answer complete/u);
    assert.doesNotMatch(textContent(button), /Private project|Sensitive prompt|session-a/u);
    assert.equal(composerNode(harness), null);

    toastNode(harness).props.onMouseEnter();
    harness.render();
    const expanded = toastNode(harness);
    const expandedText = textContent(expanded);
    assert.match(expandedText, /Private project notes/u);
    assert.match(expandedText, /Sensitive prompt body/u);
    assert.doesNotMatch(expandedText, /\u0000|[\r\n\t]/u);
    const preview = findAll(expanded, (node) => node.props?.className === 'dsh-tip-toast__prompt')[0];
    assert.ok(preview);
    assert.ok(Array.from(textContent(preview)).length <= 80);
    assert.equal(Array.from(textContent(preview)).at(-1), '…', 'truncated text ends with an ellipsis');
    assert.ok(composerNode(harness), 'composer appears in the expanded card');
  } finally {
    harness.dispose();
  }
});

test('in-card follow-up queues to the same session and keeps the notification open', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier task'), 'Session A');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Completed task'), 'Session A')]);

    toastNode(harness).props.onMouseEnter();
    harness.render();
    let input = inputNode(harness);
    assert.ok(input, 'expanded card exposes the composer');

    toastNode(harness).props.onClick({
      target: {
        closest(selector) {
          return selector === '.dsh-tip-composer' ? {} : null;
        },
      },
    });
    assert.deepEqual(harness.navigationCalls, [], 'clicking inside the composer does not navigate');

    let shiftPrevented = false;
    input.props.onKeyDown({
      key: 'Enter',
      shiftKey: true,
      isComposing: false,
      preventDefault() { shiftPrevented = true; },
    });
    assert.equal(shiftPrevented, false, 'Shift+Enter remains a newline');
    assert.equal(harness.promptCalls.length, 0);

    input.props.onChange({ target: { value: '  follow-up question  ' } });
    harness.render();
    input = inputNode(harness);
    let enterPrevented = false;
    await input.props.onKeyDown({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      preventDefault() { enterPrevented = true; },
    });
    harness.render();

    assert.equal(enterPrevented, true);
    assert.deepEqual(harness.sessionUsingCalls, [{
      target: 'session-a',
      options: { source: 'dsh-tip-completion-notice' },
    }]);
    assert.deepEqual(harness.submissionCalls[0]?.input, {
      mode: 'queue',
      text: '  follow-up question  ',
      attachments: [],
    });
    assert.deepEqual(harness.promptCalls[0]?.content, [{ type: 'text', text: '  follow-up question  ' }]);
    assert.equal(harness.promptCalls[0]?.target, 'session-a');
    assert.equal(harness.promptCalls[0]?.mode, 'queue');
    assert.equal(harness.promptCalls[0]?.signal, undefined);
    assert.equal(harness.promptCalls[0]?.requestId, harness.submissionCalls[0]?.requestId);
    assert.deepEqual(harness.navigationCalls, [], 'typing and sending do not navigate');
    assert.equal(inputNode(harness)?.props?.value, '');
    assert.match(textContent(toastNode(harness)), /Sent/u);
    assert.equal(sendButtonNode(harness)?.props?.type, 'submit');
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), []);
  } finally {
    harness.dispose();
  }
});

test('touch can expand the composer before the card navigates', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier task'), 'Session A');
  const harness = await createHarness([initial]);
  try {
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Completed task'), 'Session A')]);

    const timerBeforeExpand = [...harness.timers.keys()][0];
    actionButtonNode(harness).props.onClick({ nativeEvent: { pointerType: 'touch' } });
    harness.render();
    assert.ok(composerNode(harness), 'first touch expands the card');
    assert.notEqual([...harness.timers.keys()][0], timerBeforeExpand, 'touch expansion restarts the dismiss timer');
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [6500]);
    assert.deepEqual(harness.navigationCalls, []);

    actionButtonNode(harness).props.onClick({ nativeEvent: { pointerType: 'touch' } });
    harness.render();
    assert.deepEqual(harness.navigationCalls, ['session-a'], 'second touch follows the normal navigation action');
  } finally {
    harness.dispose();
  }
});

test('failed follow-up keeps the draft and displays a short error', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier task'), 'Session A');
  const harness = await createHarness([initial]);
  try {
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Completed task'), 'Session A')]);
    toastNode(harness).props.onMouseEnter();
    harness.render();
    inputNode(harness).props.onChange({ target: { value: 'keep this draft' } });
    harness.setPromptResult({ ok: false, error: new Error('remote rejected') });
    harness.render();

    const form = composerNode(harness);
    let prevented = false;
    await form.props.onSubmit({ preventDefault() { prevented = true; } });
    harness.render();

    assert.equal(prevented, true);
    assert.equal(inputNode(harness)?.props?.value, 'keep this draft');
    assert.match(textContent(toastNode(harness)), /Could not send\. Your draft was kept\./u);
    assert.equal(harness.abandonedSubmissions.length, 1);
    assert.deepEqual(harness.navigationCalls, []);
    assert.equal(harness.timers.size, 0, 'a failed draft pins the notice');
  } finally {
    harness.dispose();
  }
});

test('a rejected prompt abandons its echo and preserves the draft', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier task'), 'Session A');
  const harness = await createHarness([initial]);
  try {
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Completed task'), 'Session A')]);
    toastNode(harness).props.onMouseEnter();
    harness.render();
    inputNode(harness).props.onChange({ target: { value: 'survive disconnect' } });
    harness.setPromptFailure(new Error('connection lost'));
    harness.render();

    await composerNode(harness).props.onSubmit({ preventDefault() {} });
    harness.render();

    assert.equal(inputNode(harness)?.props?.value, 'survive disconnect');
    assert.match(textContent(toastNode(harness)), /Could not send\. Your draft was kept\./u);
    assert.equal(harness.abandonedSubmissions.length, 1);
    assert.deepEqual(harness.navigationCalls, []);
  } finally {
    harness.dispose();
  }
});

test('auto-dismiss pauses for hover, keyboard focus, and a non-empty draft', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier task'), 'Session A');
  const harness = await createHarness([initial]);
  try {
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Completed task'), 'Session A')]);
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [6500]);

    let card = toastNode(harness);
    card.props.onMouseEnter();
    harness.render();
    assert.equal(harness.timers.size, 0, 'hover pauses the timeout');

    card = toastNode(harness);
    card.props.onMouseLeave();
    harness.render();
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [6500]);

    card = toastNode(harness);
    card.props.onFocus();
    harness.render();
    assert.equal(harness.timers.size, 0, 'keyboard focus pauses the timeout');

    card = toastNode(harness);
    card.props.onBlur({ relatedTarget: null, currentTarget: { contains: () => false } });
    harness.render();
    card = toastNode(harness);
    card.props.onMouseEnter();
    harness.render();
    inputNode(harness).props.onChange({ target: { value: 'unsent draft' } });
    harness.render();
    toastNode(harness).props.onMouseLeave();
    harness.render();
    assert.equal(harness.timers.size, 0, 'a draft remains protected after pointer leave');
  } finally {
    harness.dispose();
  }
});

test('new completions wait until a hovered notice is released', async () => {
  const initial = [
    summary('session-a', 'both', completion(1, 100, 'Old A'), 'Session A'),
    summary('session-b', 'both', completion(1, 110, 'Old B'), 'Session B'),
  ];
  const harness = await createHarness(initial);
  try {
    harness.render();
    harness.setSnapshot([
      summary('session-a', 'both', completion(2, 200, 'Current A'), 'Session A'),
      summary('session-b', 'both', completion(1, 110, 'Old B'), 'Session B'),
    ]);
    const currentCard = toastNode(harness);
    currentCard.props.onMouseEnter();
    harness.render();

    harness.setSnapshot([
      summary('session-a', 'both', completion(3, 300, 'Later A'), 'Session A'),
      summary('session-b', 'both', completion(2, 400, 'Newest B'), 'Session B'),
    ]);
    assert.equal(actionButtonNode(harness)?.props?.key, 'session-a:2:200:header');

    toastNode(harness).props.onMouseLeave();
    harness.render();
    assert.equal(actionButtonNode(harness)?.props?.key, 'session-b:2:400:header');
  } finally {
    harness.dispose();
  }
});

test('a newer simultaneous completion restarts one newest visual cue', async () => {
  const initial = [
    summary('session-a', 'both', completion(1, 100, 'Task A'), 'Task A title'),
    summary('session-b', 'both', completion(1, 110, 'Task B'), 'Task B title'),
  ];
  const harness = await createHarness(initial);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([
      summary('session-a', 'both', completion(2, 200, 'Task A newest'), 'Task A title'),
      summary('session-b', 'both', completion(1, 110, 'Task B'), 'Task B title'),
    ]);
    const firstToast = actionButtonNode(harness);
    assert.ok(firstToast);
    assert.equal(firstToast.props.key, 'session-a:2:200:header');

    harness.setSnapshot([
      summary('session-a', 'both', completion(3, 300, 'Task A final'), 'Task A title'),
      summary('session-b', 'both', completion(2, 400, 'Task B newest'), 'Task B title'),
    ]);
    const newestToast = actionButtonNode(harness);
    assert.equal(findAll(harness.tree, (node) => node.props?.role === 'status').length, 1);
    assert.equal(newestToast?.props?.key, 'session-b:2:400:header');
    assert.notEqual(newestToast?.props?.key, firstToast.props.key);
    assert.match(textContent(newestToast), /Answer complete/u);
    assert.doesNotMatch(textContent(newestToast), /Click to open|→/iu);
  } finally {
    harness.dispose();
  }
});

test('notice auto-dismisses after 6_500ms and unmount clears its timer', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Task'), 'Task title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Task'), 'Task title')]);
    assert.ok(statusNode(harness));
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [6500]);

    harness.runNextTimer();
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);

    harness.setSnapshot([summary('session-a', 'popup', completion(3, 300, 'Task'), 'Task title')]);
    assert.ok(statusNode(harness));
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [6500]);
  } finally {
    harness.dispose();
  }
  assert.equal(harness.timers.size, 0, 'unmount must clear the notice timer');
});

test('copy is localized, actionable, and accessible', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Task'), 'Localized task');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Task'), 'Localized task')]);
    assert.equal(harness.registrations[0]?.namespace, LOCALE_NAMESPACE);
    assert.ok(harness.registrations[0]?.values?.en);
    assert.ok(harness.registrations[0]?.values?.zh);

    let status = statusNode(harness);
    let button = actionButtonNode(harness);
    assert.equal(status?.props?.['aria-live'], 'polite');
    assert.equal(status?.props?.['aria-atomic'], 'true');
    assert.match(textContent(status), /Answer complete/u);
    assert.doesNotMatch(textContent(status), /click to open|→/iu);
    assert.doesNotMatch(textContent(status), /Localized task|Task/u);
    assert.doesNotMatch(textContent(button), /click to open|→/iu);
    assert.equal(button?.type, 'button');
    assert.equal(button?.props?.['aria-label'], 'Open the completed conversation');
    assert.equal(findAll(harness.tree, (node) => Object.hasOwn(node.props ?? {}, 'autoFocus')).length, 0);
    assert.equal(harness.focusCalls, 0);

    harness.locale.setLocale('zh');
    harness.render();
    status = statusNode(harness);
    button = actionButtonNode(harness);
    assert.match(textContent(status), /回答已完成/u);
    assert.doesNotMatch(textContent(status), /点击打开|→/u);
    assert.doesNotMatch(textContent(button), /点击打开|→/u);
    assert.equal(button?.props?.['aria-label'], '打开已完成的会话');
    assert.equal(harness.focusCalls, 0);
  } finally {
    harness.dispose();
  }
});
