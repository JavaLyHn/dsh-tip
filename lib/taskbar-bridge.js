export function shouldNotifyTaskbar(mode, event) {
  return (mode === 'taskbar' || mode === 'both')
    && event?.type === 'turn/end'
    && event.data?.reason?.kind === 'completed';
}

export function postTaskbarBadge(transport, enabled) {
  if (typeof enabled !== 'boolean') return false;
  if (transport?.capability !== '1') return false;
  if (transport.platform !== 'win32') return false;
  if (transport.connected !== true || typeof transport.send !== 'function') return false;

  try {
    transport.send({ type: 'dsh-taskbar-badge', enabled });
    return true;
  } catch {
    return false;
  }
}

export function registerTaskbarEvents(ctx, mode, getTransport) {
  ctx.effect(() => {
    const disposeListener = ctx.on('session/event', (_session, event) => {
      if (shouldNotifyTaskbar(mode, event)) {
        postTaskbarBadge(getTransport(), true);
      }
    });

    return () => {
      if (typeof disposeListener === 'function') disposeListener();
      postTaskbarBadge(getTransport(), false);
    };
  });
}
