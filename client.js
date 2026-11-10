window.__ModuleLoader__.load({
  id: '@local/dsh-tip-completion-notice',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PROJECTION_KEY = 'dsh-tip/completion-notice';
    const LOCALE_NAMESPACE = 'dsh-tip-completion-notice';
    const REFERENCE_SOURCE = 'dsh-tip-completion-notice';
    const MODES = ['off', 'popup', 'taskbar', 'both'];
    const NOTICE_TIMEOUT = 6500;
    const identity = (value) => value;
    const DICTIONARIES = {
      en: {
        heading: 'Answer complete',
        openSession: 'Open the completed conversation',
        continueLabel: 'Continue this conversation',
        placeholder: 'Continue…',
        send: 'Send',
        sending: 'Sending…',
        sent: 'Sent',
        sendFailed: 'Could not send. Your draft was kept.',
        noRequestPreview: 'No request preview available.',
      },
      zh: {
        heading: '回答已完成',
        openSession: '打开已完成的会话',
        continueLabel: '继续此会话',
        placeholder: '继续输入…',
        send: '发送',
        sending: '发送中…',
        sent: '已发送',
        sendFailed: '发送失败，草稿已保留。',
        noRequestPreview: '暂无请求摘要。',
      },
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
        top: 64px;
        left: 50%;
        width: max-content;
        max-width: min(410px, calc(100vw - 28px));
        transform: translateX(-50%);
        pointer-events: none;
      }
      .dsh-tip-toast__announcement {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .dsh-tip-card {
        width: max-content;
        min-width: 196px;
        max-width: 100%;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 18px;
        background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 94%, transparent);
        color: var(--dsw-alias-label-primary);
        box-shadow: 0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
        pointer-events: auto;
        animation: dsh-tip-toast-enter 180ms ease-out both;
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }
      .dsh-tip-card--expanded {
        width: min(410px, calc(100vw - 28px));
      }
      .dsh-tip-card:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .dsh-tip-toast__header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        width: 100%;
        min-width: 0;
        min-height: 56px;
        box-sizing: border-box;
        padding: 11px 14px;
        border: 0;
        border-radius: 17px;
        background: transparent;
        color: inherit;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.25;
        text-align: left;
        cursor: pointer;
        transition: background-color 140ms ease;
      }
      .dsh-tip-toast__header:hover {
        background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 98%, transparent);
      }
      .dsh-tip-toast__header:active { transform: scale(.99); }
      .dsh-tip-toast__header:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: -3px;
      }
      .dsh-tip-toast__icon {
        display: grid;
        flex: 0 0 32px;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, var(--dsw-alias-bg-layer-1));
        color: var(--dsw-alias-state-success-primary);
        font-size: 16px;
        font-weight: 700;
        animation: dsh-tip-check-pop 420ms cubic-bezier(.2, .85, .25, 1.2) both;
      }
      .dsh-tip-toast__copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
        padding-top: 3px;
      }
      .dsh-tip-toast__title {
        overflow: hidden;
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        font-weight: 650;
        letter-spacing: .01em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-tip-toast__details {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        padding: 0 16px 12px 58px;
        animation: dsh-tip-details-enter 140ms ease-out both;
      }
      .dsh-tip-toast__session-title {
        overflow: hidden;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-tip-toast__prompt {
        display: -webkit-box;
        overflow: hidden;
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.4;
        overflow-wrap: anywhere;
        white-space: normal;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .dsh-tip-composer {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 0 12px 12px;
      }
      .dsh-tip-composer__input {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 40px;
        max-height: 112px;
        box-sizing: border-box;
        resize: vertical;
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        padding: 9px 11px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
      }
      .dsh-tip-composer__input::placeholder {
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-tip-composer__input:focus-visible {
        border-color: var(--dsw-alias-brand-primary);
        outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent);
        outline-offset: 1px;
      }
      .dsh-tip-composer__send {
        flex: 0 0 auto;
        min-height: 38px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        padding: 0 13px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1));
        color: var(--dsw-alias-label-primary);
        font: inherit;
        cursor: pointer;
      }
      .dsh-tip-composer__send:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dsh-tip-composer__send:disabled {
        cursor: not-allowed;
        opacity: .55;
      }
      .dsh-tip-toast__status {
        margin: 0;
        padding: 0 14px 11px 58px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.35;
      }
      .dsh-tip-toast__status[data-kind='error'] {
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-tip-toast__status[data-kind='sent'] {
        color: var(--dsw-alias-state-success-primary);
      }
      @keyframes dsh-tip-frame-pulse {
        0%, 100% { opacity: 0; }
        30% { opacity: .9; }
        66% { opacity: .22; }
      }
      @keyframes dsh-tip-toast-enter {
        from { opacity: 0; transform: translate3d(0, -8px, 0) scale(.98); }
        to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
      }
      @keyframes dsh-tip-details-enter {
        from { opacity: 0; transform: translateY(-3px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes dsh-tip-check-pop {
        0% { opacity: 0; transform: scale(.55) rotate(-16deg); }
        70% { opacity: 1; transform: scale(1.12) rotate(5deg); }
        100% { opacity: 1; transform: scale(1) rotate(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-tip-frame { opacity: .42; animation: none; box-shadow: none; }
        .dsh-tip-card, .dsh-tip-toast__header, .dsh-tip-toast__icon, .dsh-tip-toast__details { animation: none; transition: none; }
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

    function boundedSingleLine(value, maxCodePoints) {
      if (typeof value !== 'string') return null;
      const normalized = value
        .replace(/[\r\n\u2028\u2029\t]+/gu, ' ')
        .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!normalized) return null;
      const points = Array.from(normalized);
      if (points.length <= maxCodePoints) return normalized;
      return `${points.slice(0, maxCodePoints - 1).join('')}…`;
    }

    function boundedPromptPreview(value) {
      const preview = boundedSingleLine(value, 80);
      if (preview === null) return null;
      const points = Array.from(preview);
      return points.length < 80 ? preview : `${points.slice(0, 79).join('')}…`;
    }

    function normalizeCompletion(summary, marker) {
      const sessionTitle = boundedSingleLine(summary.displayTitle, 80)
        ?? boundedSingleLine(summary.title, 80)
        ?? boundedSingleLine(summary.id, 80)
        ?? '';
      return {
        sessionId: summary.id,
        sessionTitle,
        promptPreview: boundedPromptPreview(marker.fallbackLabel),
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

    function reconcile(previous, snapshot, statuses, pinned) {
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
        return { seen, baselineSessions, notice: null, pendingNotice: null };
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

      let notice = previous.notice;
      let pendingNotice = previous.pendingNotice ?? null;
      if (candidates.length > 0) {
        const latest = newestCompletion(candidates);
        if (pinned && notice !== null) {
          if (pendingNotice === null || isNewer(latest, pendingNotice)) pendingNotice = latest;
        } else {
          notice = latest;
          pendingNotice = null;
        }
      } else if (!pinned && pendingNotice !== null) {
        notice = pendingNotice;
        pendingNotice = null;
      }

      if (!changed
        && candidates.length === 0
        && notice === previous.notice
        && pendingNotice === previous.pendingNotice) return previous;
      return {
        seen,
        baselineSessions: previous.baselineSessions,
        notice,
        pendingNotice,
      };
    }

    function advanceNotice(previous, notice) {
      if (previous.notice !== notice) return previous;
      return {
        ...previous,
        notice: previous.pendingNotice ?? null,
        pendingNotice: null,
      };
    }

    function emptyInteraction(key) {
      return {
        key,
        hovered: false,
        focused: false,
        touchExpanded: false,
        draft: '',
        submission: { status: 'idle' },
      };
    }

    function createCompletionNotice(locale, uiWorkspace, sessionsService) {
      const translate = locale.bind(LOCALE_NAMESPACE);
      const subscribeLocale = (listener) => locale.subscribe(listener);
      const getLocaleSnapshot = () => locale.getSnapshot();

      function CompletionNotice(props) {
        React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot);
        const sessions = props.useSessions(identity);
        const statuses = props.useSessionStatus(identity);
        const [noticeState, setNoticeState] = React.useState(() => ({
          seen: null,
          baselineSessions: new Set(),
          notice: null,
          pendingNotice: null,
        }));
        const notice = noticeState.notice;
        const noticeKey = notice === null
          ? null
          : JSON.stringify([notice.sessionId, notice.seq, notice.completedAt]);
        const [interactionState, setInteractionState] = React.useState(() => emptyInteraction(null));
        const interaction = interactionState.key === noticeKey
          ? interactionState
          : emptyInteraction(noticeKey);
        const updateInteraction = (update) => {
          setInteractionState((previous) => {
            const current = previous.key === noticeKey ? previous : emptyInteraction(noticeKey);
            const next = typeof update === 'function' ? update(current) : update;
            return { ...next, key: noticeKey };
          });
        };
        const hasDraft = interaction.draft.trim().length > 0;
        const isSending = interaction.submission.status === 'sending';
        const pinned = interaction.hovered
          || interaction.focused
          || hasDraft
          || isSending
          || interaction.submission.status === 'error';
        const expanded = pinned || interaction.touchExpanded || interaction.submission.status === 'sent';

        React.useEffect(() => {
          setNoticeState((previous) => reconcile(previous, sessions, statuses, pinned));
        }, [sessions, statuses, pinned]);

        React.useEffect(() => {
          if (notice === null || pinned) return undefined;
          const timer = window.setTimeout(() => {
            setNoticeState((previous) => advanceNotice(previous, notice));
          }, NOTICE_TIMEOUT);
          return () => window.clearTimeout(timer);
        }, [notice, pinned, interaction.touchExpanded]);

        if (notice === null) return null;

        const animationKey = `${notice.sessionId}:${notice.seq}:${notice.completedAt}`;
        let submissionStatus = null;
        if (interaction.submission.status === 'sending') submissionStatus = translate('sending');
        else if (interaction.submission.status === 'sent') submissionStatus = translate('sent');
        else if (interaction.submission.status === 'error') submissionStatus = translate('sendFailed');

        async function submitDraft(event) {
          event?.preventDefault();
          const text = interaction.draft;
          if (!text.trim() || isSending) return;

          updateInteraction((previous) => ({
            ...previous,
            submission: { status: 'sending' },
          }));
          try {
            await sessionsService.using(notice.sessionId, { source: REFERENCE_SOURCE }, async (reference) => {
              const binding = await reference.ready;
              const session = binding.session;
              const submission = session.beginSubmission({
                mode: 'queue',
                text,
                attachments: [],
              });
              try {
                const result = await session.prompt(
                  [{ type: 'text', text }],
                  'queue',
                  undefined,
                  submission.requestId,
                );
                if (!result.ok) throw result.error;
              } catch (error) {
                submission.abandon();
                throw error;
              }
            });
            updateInteraction((previous) => ({
              ...previous,
              draft: '',
              submission: { status: 'sent' },
            }));
          } catch {
            updateInteraction((previous) => ({
              ...previous,
              submission: { status: 'error' },
            }));
          }
        }

        function handleInputKeyDown(event) {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.nativeEvent?.isComposing) return;
          event.preventDefault();
          return submitDraft();
        }

        function openSession(event) {
          const pointerType = event?.nativeEvent?.pointerType ?? event?.pointerType;
          if (pointerType === 'touch' && !interaction.touchExpanded) {
            updateInteraction((previous) => ({ ...previous, touchExpanded: true }));
            return;
          }
          uiWorkspace.openSession(notice.sessionId);
          if (!hasDraft && !isSending) {
            setNoticeState((previous) => advanceNotice(previous, notice));
          }
        }

        function handleCardClick(event) {
          const target = event.target;
          if (target?.closest?.('.dsh-tip-composer')) return;
          if (target?.closest?.('.dsh-tip-toast__header')) return;
          openSession(event);
        }

        function leaveCard(event) {
          const next = event.relatedTarget;
          if (next && event.currentTarget?.contains?.(next)) return;
          updateInteraction((previous) => ({
            ...previous,
            focused: false,
            touchExpanded: false,
          }));
        }

        return h('div', { className: 'dsh-tip-visual-root' },
          h('style', { 'data-dsh-tip-styles': '' }, STYLES),
          h('div', {
            key: `${animationKey}:frame`,
            className: 'dsh-tip-frame',
            'aria-hidden': true,
          }),
          h('div', { className: 'dsh-tip-toast' },
            h('div', {
              className: 'dsh-tip-toast__announcement',
              role: 'status',
              'aria-live': 'polite',
              'aria-atomic': 'true',
            }, translate('heading')),
            h('div', {
              key: `${animationKey}:card`,
              className: `dsh-tip-card${expanded ? ' dsh-tip-card--expanded' : ''}`,
              onClick: handleCardClick,
              onMouseEnter() {
                updateInteraction((previous) => ({ ...previous, hovered: true }));
              },
              onMouseLeave() {
                updateInteraction((previous) => ({ ...previous, hovered: false }));
              },
              onFocus() {
                updateInteraction((previous) => ({ ...previous, focused: true }));
              },
              onBlur: leaveCard,
            },
            h('button', {
              key: `${animationKey}:header`,
              type: 'button',
              className: 'dsh-tip-toast__header',
              'aria-label': translate('openSession'),
              'aria-expanded': expanded,
              ...(expanded ? { 'aria-controls': 'dsh-tip-expanded-details' } : {}),
              onClick: openSession,
            },
            h('span', { className: 'dsh-tip-toast__icon', 'aria-hidden': true }, '✓'),
            h('span', { className: 'dsh-tip-toast__copy' },
              h('span', { className: 'dsh-tip-toast__title' }, translate('heading')))),
            expanded && h('div', {
              id: 'dsh-tip-expanded-details',
              className: 'dsh-tip-toast__details',
            },
            h('div', { className: 'dsh-tip-toast__session-title' }, notice.sessionTitle),
            h('p', { className: 'dsh-tip-toast__prompt' }, notice.promptPreview ?? translate('noRequestPreview'))),
            expanded && h('form', {
              className: 'dsh-tip-composer',
              onSubmit: submitDraft,
            },
            h('textarea', {
              className: 'dsh-tip-composer__input',
              rows: Math.max(1, Math.min(4, interaction.draft.split('\n').length)),
              value: interaction.draft,
              placeholder: translate('placeholder'),
              'aria-label': translate('continueLabel'),
              disabled: isSending,
              onChange(event) {
                const draft = event.target.value;
                updateInteraction((previous) => ({
                  ...previous,
                  draft,
                  submission: previous.submission.status === 'error'
                    ? { status: 'idle' }
                    : previous.submission,
                }));
              },
              onKeyDown: handleInputKeyDown,
            }),
            h('button', {
              className: 'dsh-tip-composer__send',
              type: 'submit',
              disabled: !hasDraft || isSending,
            }, translate('send'))),
            submissionStatus !== null && h('p', {
              className: 'dsh-tip-toast__status',
              'aria-live': 'polite',
              'data-kind': interaction.submission.status,
            }, submissionStatus))));
      }

      return CompletionNotice;
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'sessions'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES),
          'dsh-tip-completion-notice: locale',
        );
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-tip-completion-notice',
          order: 20,
        }, createCompletionNotice(ctx.locale, ctx.uiWorkspace, ctx.sessions)));
      },
    };
  },
});
