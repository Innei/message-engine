import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  createPiMessageEngine,
  createPiOpenRouterPromptCacheBridge,
  createPiSystemPromptBridge,
  piMessageAdapter,
} from '../src/adapters/pi.js';
import { BaseFirstUserContentProvider } from '../src/providers.js';

describe('Pi adapter', () => {
  it('bridges system-phase compilation into Pi stream context', () => {
    const bridge = createPiSystemPromptBridge('base prompt');

    bridge.capture({ systemPrompt: 'base prompt\n\ntenant policy' });

    expect(bridge.current).toBe('base prompt\n\ntenant policy');
    expect(bridge.apply({ messages: [], systemPrompt: 'stale Pi snapshot' })).toEqual({
      messages: [],
      systemPrompt: 'base prompt\n\ntenant policy',
    });
  });

  it('places an explicit cache breakpoint on the stable Pi prefix', async () => {
    class StableContextProvider extends BaseFirstUserContentProvider<AgentMessage> {
      readonly id = 'test.stable-context';

      protected build(): string {
        return 'stable reference material';
      }
    }

    const engine = createPiMessageEngine({
      initial: {},
      modules: [{ id: 'test', processors: [new StableContextProvider()] }],
      services: {},
      sessionId: 'pi-cache-session',
    });
    engine.append([
      {
        content: 'current request',
        role: 'user',
        timestamp: 1,
      } as AgentMessage,
    ]);
    const result = await engine.compileTurn({ step: {} });
    const bridge = createPiOpenRouterPromptCacheBridge();
    bridge.capture(result);

    const payload = bridge.apply({
      messages: [
        { content: 'system prompt', role: 'system' },
        { content: 'stable reference material', role: 'user' },
        { content: 'current request', role: 'user' },
      ],
      model: 'openai/gpt-5.6-luna',
    });

    expect(payload.messages[1]?.content).toEqual([
      {
        cache_control: { type: 'ephemeral' },
        text: 'stable reference material',
        type: 'text',
      },
    ]);
    expect(payload.messages[2]?.content).toBe('current request');
  });

  it('keeps Pi-specific message semantics outside the core engine', async () => {
    const user = {
      content: 'hello',
      role: 'user',
      timestamp: 1,
    } as AgentMessage;
    expect(piMessageAdapter.getRole(user)).toBe('user');
    expect(piMessageAdapter.getTextSegments(user)).toEqual([
      { content: 'hello', sourceType: 'user' },
    ]);

    const engine = createPiMessageEngine({
      initial: {},
      services: {},
      sessionId: 'pi-session',
    });
    engine.append([user]);
    const result = await engine.compileTurn({ step: {} });

    expect(result.messages).toEqual([user]);
  });

  it('reads typed Pi content parts without object-shape guards', () => {
    const user = {
      content: [
        { text: 'look at this', type: 'text' },
        { data: 'aaa', mimeType: 'image/png', type: 'image' },
      ],
      role: 'user',
      timestamp: 1,
    } as AgentMessage;
    expect(piMessageAdapter.getTextSegments(user)).toEqual([
      { content: 'look at this', framingType: 'user:text', sourceType: 'user' },
    ]);
    expect(piMessageAdapter.appendTextToUserMessage(user, 'and that')).toEqual({
      content: [
        { text: 'look at this\n\nand that', type: 'text' },
        { data: 'aaa', mimeType: 'image/png', type: 'image' },
      ],
      role: 'user',
      timestamp: 1,
    });

    const assistant = {
      content: [
        { text: 'calling tools', type: 'text' },
        { arguments: { path: 'x' }, id: 'call-1', name: 'read_file', type: 'toolCall' },
      ],
      role: 'assistant',
      timestamp: 2,
    } as AgentMessage;
    expect(piMessageAdapter.getTextSegments(assistant)).toEqual([
      { content: 'calling tools', framingType: 'assistant:text', sourceType: 'assistant' },
      {
        content: '{"arguments":{"path":"x"},"id":"call-1","name":"read_file","type":"toolCall"}',
        framingType: 'assistant:tool-call',
        sourceType: 'tool-call',
      },
    ]);
    expect(piMessageAdapter.getToolCalls?.(assistant)).toEqual([
      { id: 'call-1', name: 'read_file' },
    ]);
    expect(piMessageAdapter.appendTextToUserMessage(assistant, 'nope')).toBe(assistant);

    const toolResult = {
      content: [{ text: 'ok', type: 'text' }],
      role: 'toolResult',
      timestamp: 3,
      toolCallId: 'call-1',
    } as AgentMessage;
    expect(piMessageAdapter.getToolResultId?.(toolResult)).toBe('call-1');
    expect(piMessageAdapter.getToolResultId?.(user)).toBeUndefined();
  });
});
