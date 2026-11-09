const MAX_PROMPT_CODE_POINTS = 80;

export function sanitizePromptSummary(value) {
  if (typeof value !== 'string') return '';

  const singleLine = value
    .replace(/[\r\n\u2028\u2029]+/gu, ' ')
    .replace(/[\t\v\f]/gu, ' ')
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return Array.from(singleLine).slice(0, MAX_PROMPT_CODE_POINTS).join('');
}

function promptText(message) {
  if (message?.role !== 'user' || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ');
}

export function reduceCompletion(state, event) {
  if (!state || !event || typeof event !== 'object') return state;

  if (event.type === 'user/message') {
    const pendingPrompt = sanitizePromptSummary(promptText(event.data)) || null;
    if (pendingPrompt === state.pendingPrompt) return state;
    return { ...state, pendingPrompt };
  }

  if (event.type !== 'turn/end' || event.data?.reason?.kind !== 'completed') {
    return state;
  }
  if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isFinite(event.time)) {
    return state;
  }

  return {
    pendingPrompt: null,
    lastCompletion: {
      seq: event.seq,
      time: event.time,
      fallbackLabel: state.pendingPrompt,
    },
  };
}
