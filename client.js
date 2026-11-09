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
      en: {
        heading: 'Answer complete',
        unnamedTask: 'Completed task',
        dismiss: 'Dismiss notification',
      },
      zh: {
        heading: '回答已完成',
        unnamedTask: '已完成任务',
        dismiss: '关闭提醒',
      },
    };

    function sanitizeLabel(value) {
      if (typeof value !== 'string') return '';
      return Array.from(value
        .replace(/[\r\n\u2028\u2029]+/gu, ' ')
        .replace(/[\t\v\f]/gu, ' ')
        .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim())
        .slice(0, 80)
        .join('');
    }

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
        title: sanitizeLabel(summary.title),
        fallbackLabel: sanitizeLabel(marker.fallbackLabel),
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
          }, 4000);
          return () => window.clearTimeout(timer);
        }, [notice]);

        if (notice === null) return null;
        const label = notice.title || notice.fallbackLabel || translate('unnamedTask');
        return h('div', {
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': 'true',
          style: {
            position: 'fixed',
            top: '64px',
            right: '16px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            width: 'max-content',
            maxWidth: 'min(420px, calc(100vw - 32px))',
            padding: '14px 16px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderLeft: '4px solid var(--dsw-alias-state-success-primary)',
            borderRadius: '12px',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            fontFamily: 'inherit',
            fontSize: '15px',
            lineHeight: 1.45,
            pointerEvents: 'auto',
          },
        },
        h('span', {
          'aria-hidden': true,
          style: {
            color: 'var(--dsw-alias-state-success-primary)',
            fontSize: '18px',
            fontWeight: 700,
            lineHeight: 1,
            marginTop: '1px',
          },
        }, '✓'),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { style: { fontWeight: 700, marginBottom: '3px' } }, translate('heading')),
          h('div', { style: { overflowWrap: 'anywhere' } }, label)),
        h('button', {
          type: 'button',
          'aria-label': translate('dismiss'),
          onClick() {
            setNoticeState((previous) => previous.notice === notice
              ? { ...previous, notice: null }
              : previous);
          },
          style: {
            flex: 'none',
            padding: 0,
            border: 0,
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            font: 'inherit',
            fontSize: '18px',
            lineHeight: 1,
            cursor: 'pointer',
          },
        }, h('span', { 'aria-hidden': true }, '×')));
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
