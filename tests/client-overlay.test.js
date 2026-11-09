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
  const ctx = {
    locale,
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
    get tree() { return renderer?.render() ?? null; },
    timers,
    registrations,
    locale,
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
}

function statusNode(harness) {
  return findAll(harness.tree, (node) => node.props?.role === 'status')[0] ?? null;
}

function closeButton(harness) {
  return findAll(harness.tree, (node) => node.type === 'button')[0] ?? null;
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
    assert.match(textContent(harness.tree), /New session/u);
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

test('title precedes fallback', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier prompt'), 'Earlier title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Prompt fallback'), 'Chosen session title')]);
    assert.match(textContent(harness.tree), /Chosen session title/u);
    assert.doesNotMatch(textContent(harness.tree), /Prompt fallback/u);

    harness.setSnapshot([summary('session-a', 'popup', completion(3, 300, 'Newest prompt fallback'), '')]);
    assert.match(textContent(harness.tree), /Newest prompt fallback/u);
    assert.doesNotMatch(textContent(harness.tree), /Chosen session title/u);
  } finally {
    harness.dispose();
  }
});

test('title and fallback labels stay bounded and control-free', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Earlier task'), 'Earlier title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    const hostileTitle = `  Project\r\nnotes\t\u0000${'🧭'.repeat(100)}  `;
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Ignored fallback'), hostileTitle)]);
    let label = findAll(harness.tree, (node) => node.props?.style?.overflowWrap === 'anywhere')[0];
    let visible = textContent(label);
    assert.equal(Array.from(visible).length, 80);
    assert.equal(/[\r\n\u0000-\u001f\u007f-\u009f]/u.test(visible), false);
    assert.ok(visible.startsWith('Project notes'));
    assert.equal(visible.includes('Ignored fallback'), false);
    assert.equal(visible.includes('session-a'), false);

    const hostileFallback = `Fallback\r\nsummary\t\u0000${'🧭'.repeat(100)}`;
    harness.setSnapshot([summary('session-a', 'popup', completion(3, 300, hostileFallback), '')]);
    label = findAll(harness.tree, (node) => node.props?.style?.overflowWrap === 'anywhere')[0];
    visible = textContent(label);
    assert.equal(Array.from(visible).length, 80);
    assert.equal(/[\r\n\u0000-\u001f\u007f-\u009f]/u.test(visible), false);
    assert.ok(visible.startsWith('Fallback summary'));
    assert.equal(visible.includes('session-a'), false);
  } finally {
    harness.dispose();
  }
});

test('new sequence replaces and simultaneous completions yield one newest toast', async () => {
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
    assert.match(textContent(harness.tree), /Task A title/u);

    harness.setSnapshot([
      summary('session-a', 'both', completion(3, 300, 'Task A final'), 'Task A title'),
      summary('session-b', 'both', completion(2, 400, 'Task B newest'), 'Task B title'),
    ]);
    assert.equal(findAll(harness.tree, (node) => node.props?.role === 'status').length, 1);
    assert.match(textContent(harness.tree), /Task B title/u);
    assert.doesNotMatch(textContent(harness.tree), /Task A title/u);
  } finally {
    harness.dispose();
  }
});

test('close and 4_000ms timeout dismiss', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Task'), 'Task title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Task'), 'Task title')]);
    assert.ok(statusNode(harness));
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [4000]);

    closeButton(harness).props.onClick();
    harness.render();
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);

    harness.setSnapshot([summary('session-a', 'popup', completion(3, 300, 'Task'), 'Task title')]);
    assert.ok(statusNode(harness));
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [4000]);
    harness.runNextTimer();
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);

    harness.setSnapshot([summary('session-a', 'popup', completion(4, 400, 'Task'), 'Task title')]);
    assert.equal(harness.timers.size, 1);
  } finally {
    harness.dispose();
  }
  assert.equal(harness.timers.size, 0, 'unmount must clear the notice timer');
});

test('copy is localized and accessible', async () => {
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
    assert.equal(status?.props?.['aria-live'], 'polite');
    assert.equal(status?.props?.['aria-atomic'], 'true');
    assert.match(textContent(status), /Answer complete/u);
    assert.match(textContent(status), /Localized task/u);
    assert.equal(closeButton(harness)?.props?.['aria-label'], 'Dismiss notification');
    assert.equal(findAll(harness.tree, (node) => Object.hasOwn(node.props ?? {}, 'autoFocus')).length, 0);
    assert.equal(harness.focusCalls, 0);

    harness.locale.setLocale('zh');
    harness.render();
    status = statusNode(harness);
    assert.match(textContent(status), /回答已完成/u);
    assert.equal(closeButton(harness)?.props?.['aria-label'], '关闭提醒');
    assert.equal(harness.focusCalls, 0);
  } finally {
    harness.dispose();
  }
});
