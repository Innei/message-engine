import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { canonicalStringify, fingerprint } from '../fingerprint.js';
import type {
  InjectedUserMessageContext,
  MessageAdapter,
  MessageTextSegment,
} from '../message-adapter.js';
import { SessionMessagesEngine } from '../session-engine.js';
import type { TokenSourceType } from '../token-types.js';
import type { SessionMessagesEngineOptions } from '../types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const piMessageEngineContext = Symbol('message-engine.pi.context');

type ContextTaggedAgentMessage = AgentMessage & {
  [piMessageEngineContext]?: InjectedUserMessageContext;
};

export interface PiSystemPromptBridge {
  apply<Context extends object>(context: Context): Context & { systemPrompt: string };
  capture(result: { systemPrompt: string }): void;
  readonly current: string;
}

/**
 * Pi snapshots its system prompt before calling `transformContext`, while the
 * message engine compiles system-phase contributions during that transform.
 * Capture the compiled prompt and apply it in Pi's `streamFn` so both runtimes
 * observe the same model-visible system context.
 */
export const createPiSystemPromptBridge = (initialSystemPrompt: string): PiSystemPromptBridge => {
  let current = initialSystemPrompt;

  return {
    apply: (context) => ({ ...context, systemPrompt: current }),
    capture: (result) => {
      current = result.systemPrompt;
    },
    get current() {
      return current;
    },
  };
};

export interface PiOpenRouterPromptCacheBridge {
  apply<Payload>(payload: Payload): Payload;
  capture(result: { messages: AgentMessage[] }): void;
}

export interface PiOpenRouterPromptCacheBridgeOptions {
  ttl?: '5m' | '1h';
}

const addCacheControl = (
  message: Record<string, unknown>,
  cacheControl: { ttl?: '1h'; type: 'ephemeral' },
): Record<string, unknown> => {
  const content = message.content;
  if (typeof content === 'string') {
    return {
      ...message,
      content: [{ cache_control: cacheControl, text: content, type: 'text' }],
    };
  }
  if (!Array.isArray(content)) return message;

  let annotated = false;
  const nextContent = content.map((part, index) => {
    if (annotated || !isRecord(part) || part.type !== 'text') return part;
    const hasLaterText = content
      .slice(index + 1)
      .some((candidate) => isRecord(candidate) && candidate.type === 'text');
    if (hasLaterText) return part;
    annotated = true;
    return { ...part, cache_control: cacheControl };
  });
  return annotated ? { ...message, content: nextContent } : message;
};

/**
 * Mark session-scoped stable-prefix messages as explicit OpenRouter cache
 * breakpoints after Pi converts AgentMessage objects into provider payloads.
 * This keeps ephemeral user augmentation and virtual-tail messages outside the
 * cached block while allowing GPT-5.6+ and explicit-cache providers to reuse
 * the stable prefix on the next turn.
 */
export const createPiOpenRouterPromptCacheBridge = (
  options: PiOpenRouterPromptCacheBridgeOptions = {},
): PiOpenRouterPromptCacheBridge => {
  let stableUserOrdinals = new Set<number>();
  const cacheControl = {
    ...(options.ttl === '1h' ? { ttl: '1h' as const } : {}),
    type: 'ephemeral' as const,
  };

  return {
    apply: <Payload>(payload: Payload): Payload => {
      if (!isRecord(payload) || !Array.isArray(payload.messages)) return payload;

      let userOrdinal = -1;
      const messages = payload.messages.map((message) => {
        if (!isRecord(message) || message.role !== 'user') return message;
        userOrdinal += 1;
        return stableUserOrdinals.has(userOrdinal)
          ? addCacheControl(message, cacheControl)
          : message;
      });
      return { ...payload, messages } as Payload;
    },
    capture: (result) => {
      const ordinals = new Set<number>();
      let userOrdinal = -1;
      for (const message of result.messages) {
        if (!isRecord(message) || message.role !== 'user') continue;
        userOrdinal += 1;
        const context = (message as ContextTaggedAgentMessage)[piMessageEngineContext];
        if (context?.slot === 'stable-prefix' && context.cacheScope === 'session') {
          ordinals.add(userOrdinal);
        }
      }
      stableUserOrdinals = ordinals;
    },
  };
};

const sourceTypeForRole = (role: string): TokenSourceType => {
  switch (role) {
    case 'assistant':
      return 'assistant';
    case 'toolResult':
      return 'tool-result';
    case 'user':
      return 'user';
    default:
      return 'unattributed';
  }
};

const getTextSegments = (message: AgentMessage): MessageTextSegment[] => {
  if (!isRecord(message)) return [];
  const role = typeof message.role === 'string' ? message.role : 'custom';
  const sourceType = sourceTypeForRole(role);
  const content = message.content;
  if (typeof content === 'string') return [{ content, sourceType }];
  if (!Array.isArray(content)) return [];

  const segments: MessageTextSegment[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (typeof part.text === 'string') {
      segments.push({
        content: part.text,
        framingType: `${role}:${String(part.type)}`,
        sourceType,
      });
    } else if (part.type === 'toolCall') {
      segments.push({
        content: canonicalStringify(part),
        framingType: 'assistant:tool-call',
        sourceType: 'tool-call',
      });
    }
  }
  return segments;
};

export const piMessageAdapter: MessageAdapter<AgentMessage> = {
  id: 'pi-agent-core/agent-message@0.84',

  appendTextToUserMessage(message, content) {
    if (!isRecord(message) || message.role !== 'user') return message;

    if (typeof message.content === 'string') {
      return { ...message, content: `${message.content}\n\n${content}` } as AgentMessage;
    }
    if (!Array.isArray(message.content)) return message;

    const parts = [...message.content];
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') continue;
      parts[index] = { ...part, text: `${part.text}\n\n${content}` };
      return { ...message, content: parts } as AgentMessage;
    }

    return {
      ...message,
      content: [...parts, { text: content, type: 'text' }],
    } as AgentMessage;
  },

  clone: (message) => structuredClone(message),

  createUserMessage: (content, timestamp = Date.now(), context) =>
    ({
      content,
      role: 'user',
      timestamp,
      ...(context ? { [piMessageEngineContext]: context } : {}),
    }) as AgentMessage,

  fingerprint,

  getRole: (message) =>
    isRecord(message) && typeof message.role === 'string' ? message.role : 'custom',

  getTextSegments,

  getToolCalls(message) {
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) {
      return [];
    }

    const calls: Array<{ id: string; name: string }> = [];
    for (const part of message.content) {
      if (!isRecord(part) || part.type !== 'toolCall') continue;
      if (typeof part.id === 'string' && typeof part.name === 'string') {
        calls.push({ id: part.id, name: part.name });
      }
    }
    return calls;
  },

  getToolResultId: (message) =>
    isRecord(message) && message.role === 'toolResult' && typeof message.toolCallId === 'string'
      ? message.toolCallId
      : undefined,

  replaceToolResultText(message, text) {
    if (!isRecord(message) || message.role !== 'toolResult') return message;
    if (typeof message.content === 'string') {
      return { ...message, content: text } as unknown as AgentMessage;
    }
    if (Array.isArray(message.content)) {
      const parts = [...message.content];
      const textIndex = parts.findIndex(
        (part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string',
      );
      if (textIndex === -1) {
        return { ...message, content: [{ text, type: 'text' }] } as AgentMessage;
      }
      const current = parts[textIndex];
      if (!isRecord(current)) return message;
      parts[textIndex] = { ...current, text } as (typeof parts)[number];
      return { ...message, content: parts } as AgentMessage;
    }
    return { ...message, content: text } as unknown as AgentMessage;
  },
};

export type PiMessageEngineOptions<
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> = Omit<SessionMessagesEngineOptions<AgentMessage, Initial, Step, Services, Metadata>, 'adapter'>;

export const createPiMessageEngine = <
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
>(
  options: PiMessageEngineOptions<Initial, Step, Services, Metadata>,
): SessionMessagesEngine<AgentMessage, Initial, Step, Services, Metadata> =>
  new SessionMessagesEngine({ ...options, adapter: piMessageAdapter });

export type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
