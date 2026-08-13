import type { TokenCacheScope, TokenSourceType, TokenizerSegment } from './token-types.js';
import { fingerprint } from './fingerprint.js';

export interface MessageTextSegment {
  content: string;
  framingType?: string;
  sourceType?: TokenSourceType;
}

export interface InjectedUserMessageContext {
  cacheScope: TokenCacheScope;
  slot: 'stable-prefix' | 'virtual-tail';
}

export interface MessageAdapter<Message> {
  readonly id: string;
  appendTextToUserMessage(message: Message, content: string): Message;
  clone(message: Message): Message;
  createUserMessage(
    content: string,
    timestamp?: number,
    context?: InjectedUserMessageContext,
  ): Message;
  fingerprint(message: Message): string;
  getRole(message: Message): string;
  getTextSegments(message: Message): readonly MessageTextSegment[];
  getToolCalls?(message: Message): ReadonlyArray<{ id: string; name: string }>;
  getToolResultId?(message: Message): string | undefined;
}

export const messageToTokenSegments = <Message>(
  adapter: MessageAdapter<Message>,
  message: Message,
  messageId: string,
): TokenizerSegment[] => {
  const role = adapter.getRole(message);
  return adapter.getTextSegments(message).map((segment, partIndex) => ({
    cacheScope: 'message',
    content: segment.content,
    contentDigest: fingerprint(segment.content),
    framingType: segment.framingType ?? `${role}:content`,
    messageId,
    moduleId: 'transcript',
    processorId: 'raw-message',
    segmentId: `${messageId}:content:${partIndex}`,
    sourceType: segment.sourceType ?? 'unattributed',
  }));
};
