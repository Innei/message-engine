import type { MessageProcessor } from './types.js';

export interface ToolResultRewriteInput<Message> {
  index: number;
  message: Message;
  toolCallId: string;
}

export type ToolResultRewrite<Message> = (
  input: ToolResultRewriteInput<Message>,
) => Message | string | undefined;

export const createToolResultRewriteProcessor = <
  Message,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
>(
  rewrite: ToolResultRewrite<Message>,
): MessageProcessor<Message, Initial, Step, Services, Metadata> => {
  const pinned = new Map<string, Message>();
  let pinnedGeneration: number | undefined;
  return {
    id: 'history.rewrite-tool-results',
    phase: 'history',
    access: { reads: ['content', 'ids'], writes: 'content' },
    process(context) {
      if (pinnedGeneration !== context.generation) {
        pinned.clear();
        pinnedGeneration = context.generation;
      }
      for (let index = 0; index < context.messages.length; index += 1) {
        const message = context.messages[index];
        if (message === undefined) continue;
        const toolCallId = context.getToolResultId(message);
        if (!toolCallId) continue;
        const existing = pinned.get(toolCallId);
        if (existing) {
          context.replaceMessage(index, existing);
          continue;
        }
        const result = rewrite({ index, message, toolCallId });
        if (result === undefined) continue;
        if (typeof result === 'string') {
          context.replaceToolResultText(index, result);
        } else {
          const nextId = context.getToolResultId(result);
          if (nextId !== toolCallId) {
            throw new Error(`tool result rewrite changed toolCallId ${toolCallId}`);
          }
          context.replaceMessage(index, result);
        }
        const applied = context.messages[index];
        if (applied !== undefined) pinned.set(toolCallId, applied);
      }
    },
  };
};
