import { z } from 'zod';
import Schema from '@deepseek-ai/schemastery';
import { reduceCompletion } from './lib/completion-projection.js';
import { registerTaskbarEvents } from './lib/taskbar-bridge.js';

const MODES = ['off', 'popup', 'taskbar', 'both'];
const COMPLETION_KEY = 'dsh-tip/completion-notice';
const boundedLabelSchema = z.string().refine((value) => Array.from(value).length <= 80);
const completionSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number(),
  fallbackLabel: boundedLabelSchema.nullable(),
});
const stateSchema = z.object({
  pendingPrompt: boundedLabelSchema.nullable(),
  lastCompletion: completionSchema.nullable(),
});
const viewSchema = z.object({
  mode: z.enum(MODES),
  lastCompletion: completionSchema.nullable(),
});

export const Config = Schema.object({
  mode: Schema.union(MODES.map((mode) => Schema.const(mode))).default('both'),
});

export const inject = ['sessionProjections'];

function taskbarTransport() {
  return {
    capability: process.env.DSH_DESKTOP_TASKBAR_API,
    platform: process.platform,
    connected: process.connected === true,
    send: typeof process.send === 'function' ? process.send.bind(process) : undefined,
  };
}

export async function apply(ctx, config) {
  await ctx.sessionProjections.register({
    key: COMPLETION_KEY,
    stateSchema,
    stateVersion: 1,
    init() {
      return { pendingPrompt: null, lastCompletion: null };
    },
    apply: reduceCompletion,
    wire: {
      viewSchema,
      view(state) {
        return { mode: config.mode, lastCompletion: state.lastCompletion };
      },
      summary: true,
    },
  });

  registerTaskbarEvents(ctx, config.mode, taskbarTransport);
}
