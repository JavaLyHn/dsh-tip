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

function toastNode(harness) {
  return findAll(harness.tree, (node) => node.props?.className === 'dsh-tip-toast')[0] ?? null;
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

test('completion cue is compact, click-through, animated, and motion-aware', async () => {
  const harness = await createHarness([]);
  try {
    harness.render();
    harness.setSnapshot([
      summary('session-new', 'popup', completion(1, 100, 'Fresh prompt'), 'New session'),
    ]);

    const toast = toastNode(harness);
    assert.ok(toast, 'completion toast is missing');
    assert.equal(toast.props.role, 'status');
    assert.equal(toast.props['aria-live'], 'polite');
    assert.equal(toast.props.className, 'dsh-tip-toast');
    assert.equal(frameNode(harness)?.props?.['aria-hidden'], true);

    const css = textContent(styleNode(harness));
    assert.match(css, /bottom:\s*16px/u);
    assert.match(css, /max-width:\s*min\(224px, calc\(100vw - 24px\)\)/u);
    assert.match(css, /pointer-events:\s*none/u);
    assert.match(css, /dsh-tip-frame-pulse 1\.25s ease-in-out 2/u);
    assert.match(css, /dsh-tip-toast-life 5200ms/u);
    assert.match(css, /background:\s*color-mix\(in srgb, var\(--dsw-alias-bg-overlay\) 84%, transparent\)/u);
    assert.doesNotMatch(css, /backdrop-filter/u);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
    assert.match(css, /--dsw-alias-brand-primary/u);
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/iu);
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

test('completion notice does not reveal session titles or prompt previews', async () => {
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

    const visible = textContent(statusNode(harness));
    assert.equal(visible, '✓Answer complete');
    assert.doesNotMatch(visible, /Private project|Sensitive prompt|session-a/u);
    assert.equal(findAll(statusNode(harness), (node) => node.type === 'button').length, 0);
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
    const firstToast = toastNode(harness);
    assert.ok(firstToast);
    assert.equal(firstToast.props.key, 'session-a:2:200:toast');

    harness.setSnapshot([
      summary('session-a', 'both', completion(3, 300, 'Task A final'), 'Task A title'),
      summary('session-b', 'both', completion(2, 400, 'Task B newest'), 'Task B title'),
    ]);
    const newestToast = toastNode(harness);
    assert.equal(findAll(harness.tree, (node) => node.props?.role === 'status').length, 1);
    assert.equal(newestToast?.props?.key, 'session-b:2:400:toast');
    assert.notEqual(newestToast?.props?.key, firstToast.props.key);
    assert.equal(textContent(newestToast), '✓Answer complete');
  } finally {
    harness.dispose();
  }
});

test('notice auto-dismisses after 5_200ms and unmount clears its timer', async () => {
  const initial = summary('session-a', 'popup', completion(1, 100, 'Task'), 'Task title');
  const harness = await createHarness([initial]);
  try {
    assertOverlay(harness);
    harness.render();
    harness.setSnapshot([summary('session-a', 'popup', completion(2, 200, 'Task'), 'Task title')]);
    assert.ok(statusNode(harness));
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [5200]);

    harness.runNextTimer();
    assert.equal(statusNode(harness), null);
    assert.equal(harness.timers.size, 0);

    harness.setSnapshot([summary('session-a', 'popup', completion(3, 300, 'Task'), 'Task title')]);
    assert.ok(statusNode(harness));
    assert.deepEqual([...harness.timers.values()].map((timer) => timer.delay), [5200]);
  } finally {
    harness.dispose();
  }
  assert.equal(harness.timers.size, 0, 'unmount must clear the notice timer');
});

test('copy is localized, non-disruptive, and accessible', async () => {
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
    assert.equal(textContent(status), '✓Answer complete');
    assert.doesNotMatch(textContent(status), /Localized task|Task/u);
    assert.equal(findAll(status, (node) => node.type === 'button').length, 0);
    assert.equal(findAll(harness.tree, (node) => Object.hasOwn(node.props ?? {}, 'autoFocus')).length, 0);
    assert.equal(harness.focusCalls, 0);

    harness.locale.setLocale('zh');
    harness.render();
    status = statusNode(harness);
    assert.equal(textContent(status), '✓回答已完成');
    assert.equal(harness.focusCalls, 0);
  } finally {
    harness.dispose();
  }
});
