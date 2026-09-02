import { PipelineConfigurationError } from './errors.js';
import { PipelineExecutionContext } from './pipeline.js';
import type { MessageProcessor } from './types.js';

export interface ToolResultRewriteInput<Message> {
  index: number;
  message: Message;
  ordinal: number;
  toolCallId: string;
  total: number;
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
): MessageProcessor<Message, Initial, Step, Services, Metadata> => ({
  id: 'history.rewrite-tool-results',
  phase: 'history',
  access: { reads: ['content', 'ids'], writes: 'content' },
  process(context) {
    if (!(context instanceof PipelineExecutionContext)) {
      throw new PipelineConfigurationError(
        'tool result rewrite requires the engine pipeline context',
      );
    }
    const pinned = context.toolResultPins;
    const targets: Array<{ index: number; message: Message; toolCallId: string }> = [];
    context.messages.forEach((message, index) => {
      const toolCallId = context.getToolResultId(message);
      if (toolCallId) targets.push({ index, message, toolCallId });
    });

    targets.forEach(({ index, message, toolCallId }, ordinal) => {
      const existing = pinned.get(toolCallId);
      if (existing !== undefined) {
        if (existing !== message) context.replaceMessage(index, existing);
        return;
      }
      const result = rewrite({ index, message, ordinal, toolCallId, total: targets.length });
      if (typeof result === 'string') {
        context.replaceToolResultText(index, result);
      } else if (result !== undefined) {
        if (context.getToolResultId(result) !== toolCallId) {
          throw new Error(`tool result rewrite changed toolCallId ${toolCallId}`);
        }
        context.replaceMessage(index, result);
      }
      const applied = context.messages[index];
      if (applied !== undefined) pinned.set(toolCallId, applied);
    });
  },
});
