window.__ModuleLoader__.load({
  id: '@local/dsh-tip-completion-notice',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PROJECTION_KEY = 'dsh-tip/completion-notice';
    const LOCALE_NAMESPACE = 'dsh-tip-completion-notice';
    const MODES = ['off', 'popup', 'taskbar', 'both'];
    const identity = (value) => value;
    const DICTIONARIES = {
      en: { heading: 'Answer complete' },
      zh: { heading: '回答已完成' },
    };
    const STYLES = `
      .dsh-tip-visual-root {
        position: fixed;
        inset: 0;
        z-index: 1200;
        pointer-events: none;
      }
      .dsh-tip-frame {
        position: absolute;
        inset: 8px;
        border: 1px solid var(--dsw-alias-brand-primary);
        border-radius: 12px;
        opacity: 0;
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent),
          0 0 18px color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent);
        animation: dsh-tip-frame-pulse 1.25s ease-in-out 2 both;
      }
      .dsh-tip-toast {
        position: absolute;
        right: 16px;
        bottom: 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        width: max-content;
        max-width: min(224px, calc(100vw - 24px));
        min-height: 44px;
        box-sizing: border-box;
        padding: 8px 14px 8px 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 84%, transparent);
        color: var(--dsw-alias-label-primary);
        box-shadow: 0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
        font-family: inherit;
        font-size: 14px;
        line-height: 1.2;
        pointer-events: none;
        animation: dsh-tip-toast-life 5200ms linear both;
      }
      .dsh-tip-toast__icon {
        display: grid;
        flex: 0 0 28px;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, var(--dsw-alias-bg-layer-1));
        color: var(--dsw-alias-state-success-primary);
        font-size: 15px;
        font-weight: 700;
        animation: dsh-tip-check-pop 420ms cubic-bezier(.2, .85, .25, 1.2) both;
      }
      .dsh-tip-toast__text {
        overflow: hidden;
        color: var(--dsw-alias-label-primary);
        font-weight: 650;
        letter-spacing: .01em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @keyframes dsh-tip-frame-pulse {
        0%, 100% { opacity: 0; }
        30% { opacity: .9; }
        66% { opacity: .22; }
      }
      @keyframes dsh-tip-toast-life {
        0% { opacity: 0; transform: translate3d(0, 10px, 0) scale(.97); }
        8% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        88% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        100% { opacity: 0; transform: translate3d(0, 5px, 0) scale(.985); }
      }
      @keyframes dsh-tip-check-pop {
        0% { opacity: 0; transform: scale(.55) rotate(-16deg); }
        70% { opacity: 1; transform: scale(1.12) rotate(5deg); }
        100% { opacity: 1; transform: scale(1) rotate(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-tip-frame { opacity: .42; animation: none; box-shadow: none; }
        .dsh-tip-toast, .dsh-tip-toast__icon { animation: none; }
      }
    `;

    function readProjection(summary) {
      const projection = summary?.projectionValues?.[PROJECTION_KEY];
      if (!projection || !MODES.includes(projection.mode)) return null;
      const marker = projection.lastCompletion;
      const validMarker = marker
        && Number.isSafeInteger(marker.seq)
        && marker.seq >= 0
        && Number.isFinite(marker.time);
      return {
        mode: projection.mode,
        completion: validMarker ? marker : null,
      };
    }

    function normalizeCompletion(summary, marker) {
      return {
        sessionId: summary.id,
        seq: marker.seq,
        completedAt: marker.time,
      };
    }

    function isPopupMode(mode) {
      return mode === 'popup' || mode === 'both';
    }

    function isNewer(left, right) {
      if (left.completedAt !== right.completedAt) return left.completedAt > right.completedAt;
      if (left.sessionId !== right.sessionId) return left.sessionId > right.sessionId;
      return left.seq > right.seq;
    }

    function newestCompletion(candidates) {
      return candidates.reduce((latest, candidate) => isNewer(candidate, latest) ? candidate : latest);
    }

    function rowsFrom(snapshot) {
      if (!snapshot?.byId || typeof snapshot.byId !== 'object') return [];
      return Object.values(snapshot.byId).filter((summary) => summary && typeof summary.id === 'string');
    }

    function reconcile(previous, snapshot, statuses) {
      if (snapshot?.phase !== 'ready') return previous;
      const rows = rowsFrom(snapshot);
      if (previous.seen === null) {
        const seen = new Map();
        const baselineSessions = new Set(rows.map((summary) => summary.id));
        for (const summary of rows) {
          const projection = readProjection(summary);
          if (!projection) continue;
          seen.set(summary.id, projection.completion?.seq ?? null);
        }
        return { seen, baselineSessions, notice: null };
      }

      const present = new Set(rows.map((summary) => summary.id));
      const seen = new Map(previous.seen);
      let changed = false;
      for (const sessionId of seen.keys()) {
        if (present.has(sessionId)) continue;
        seen.delete(sessionId);
        changed = true;
      }

      const candidates = [];
      for (const summary of rows) {
        const projection = readProjection(summary);
        if (!projection) continue;
        const marker = projection.completion;
        const currentSeq = marker?.seq ?? null;
        if (!seen.has(summary.id)) {
          if (previous.baselineSessions.has(summary.id)) {
            seen.set(summary.id, currentSeq);
            changed = true;
            continue;
          }
          seen.set(summary.id, null);
          changed = true;
        }
        if (currentSeq === null) continue;

        const previousSeq = seen.get(summary.id);
        if (previousSeq !== null && currentSeq <= previousSeq) continue;

        const popupMode = isPopupMode(projection.mode);
        const statusKnown = typeof statuses?.has !== 'function' || statuses.has(summary.id);
        if (popupMode && !statusKnown) continue;

        seen.set(summary.id, currentSeq);
        changed = true;
        if (popupMode) candidates.push(normalizeCompletion(summary, marker));
      }

      if (!changed && candidates.length === 0) return previous;
      return {
        seen,
        baselineSessions: previous.baselineSessions,
        notice: candidates.length > 0 ? newestCompletion(candidates) : previous.notice,
      };
    }

    function createCompletionNotice(locale) {
      const translate = locale.bind(LOCALE_NAMESPACE);
      const subscribeLocale = (listener) => locale.subscribe(listener);
      const getLocaleSnapshot = () => locale.getSnapshot();

      function CompletionNotice(props) {
        React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot);
        const sessions = props.useSessions(identity);
        const statuses = props.useSessionStatus(identity);
        const [noticeState, setNoticeState] = React.useState(() => ({ seen: null, notice: null }));
        const notice = noticeState.notice;

        React.useEffect(() => {
          setNoticeState((previous) => reconcile(previous, sessions, statuses));
        }, [sessions, statuses]);

        React.useEffect(() => {
          if (notice === null) return undefined;
          const timer = window.setTimeout(() => {
            setNoticeState((previous) => previous.notice === notice
              ? { ...previous, notice: null }
              : previous);
          }, 5200);
          return () => window.clearTimeout(timer);
        }, [notice]);

        if (notice === null) return null;
        const animationKey = `${notice.sessionId}:${notice.seq}:${notice.completedAt}`;
        return h('div', { className: 'dsh-tip-visual-root' },
          h('style', { 'data-dsh-tip-styles': '' }, STYLES),
          h('div', {
            key: `${animationKey}:frame`,
            className: 'dsh-tip-frame',
            'aria-hidden': true,
          }),
          h('div', {
            key: `${animationKey}:toast`,
            className: 'dsh-tip-toast',
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
          },
          h('span', { className: 'dsh-tip-toast__icon', 'aria-hidden': true }, '✓'),
          h('span', { className: 'dsh-tip-toast__text' }, translate('heading'))));
      }

      return CompletionNotice;
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES),
          'dsh-tip-completion-notice: locale',
        );
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-tip-completion-notice',
          order: 20,
        }, createCompletionNotice(ctx.locale)));
      },
    };
  },
});
