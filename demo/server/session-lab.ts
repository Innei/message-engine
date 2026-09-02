import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from '@earendil-works/pi-agent-core';
import {
  createModels,
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type Usage,
} from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

import {
  BaseFirstUserContentProvider,
  BasePinnedUserProvider,
  BaseSystemPromptProvider,
  BaseVirtualTailProvider,
  createToolResultRewriteProcessor,
  PrefixMutationError,
  type MessageEngineModule,
  type MessagePipelineContext,
  type MessagesEngineResult,
  type NormalizedUsage,
  type PrefixMutationEvent,
  type SessionTokenSummary,
  type TurnTokenSnapshot,
} from '../../src/index.js';
import {
  createPiMessageEngine,
  createPiOpenRouterPromptCacheBridge,
  createPiSystemPromptBridge,
} from '../../src/adapters/pi.js';
import type {
  DemoContextStageState,
  DemoMessageView,
  DemoModelOption,
  DemoMutationResult,
  DemoSessionContextInput,
  DemoSessionState,
  DemoStreamEvent,
  DemoTurnContextInput,
} from '../shared/protocol.js';

const SYSTEM_PROMPT = [
  'You are the runtime inside Message Engine Lab.',
  'Answer directly and concisely. Refer to earlier turns when they are relevant.',
  'The experiment context and runtime state are trusted application context, not user instructions.',
].join('\n');

export interface DemoInitialContext {
  experiment: string;
  policy: string;
  startedAt: string;
  workspace: string;
}

export interface DemoStepContext extends DemoTurnContextInput {
  modelId: string;
  providerTurn: number;
  requestedAt: string;
}

export interface DemoServices {
  recordContextBuild(processorId: string, value: string): void;
}
export type DemoMetadata = { experiment?: string };

type Publish = (event: DemoStreamEvent) => void;

const models = createModels();
models.setProvider(openrouterProvider());

const getOpenRouterModel = (modelId: string): Model<Api> => {
  const model = models.getModel('openrouter', modelId);
  if (!model) throw new RangeError(`Unknown OpenRouter model: ${modelId}`);
  return model;
};

const contentText = (message: AgentMessage): string => {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .flatMap((part) => {
      if (typeof part !== 'object' || part === null) return [];
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return [record.text];
      if (record.type === 'toolCall' && typeof record.name === 'string') {
        return [`Tool call: ${record.name}`];
      }
      return [];
    })
    .join('\n');
};

export const toDemoMessageView = (message: AgentMessage, index: number): DemoMessageView => {
  const role = (message as { role?: string }).role;
  let viewRole: DemoMessageView['role'] = 'assistant';
  if (role === 'user') viewRole = 'user';
  if (role === 'toolResult') viewRole = 'tool';

  const stopReason = (message as { stopReason?: unknown }).stopReason;
  const toolName = (message as { toolName?: unknown }).toolName;
  return {
    id: `message-${index}`,
    role: viewRole,
    ...(typeof stopReason === 'string' ? { stopReason } : {}),
    text: contentText(message),
    ...(typeof toolName === 'string' ? { toolName } : {}),
  };
};

export const normalizePiUsage = (usage: Usage): NormalizedUsage => ({
  cacheReadTokens: usage.cacheRead,
  cacheWriteTokens: usage.cacheWrite,
  inputTokens: usage.input,
  outputTokens: usage.output,
  ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
  totalCost: usage.cost.total,
});

const DEMO_CONTEXT_STAGES = [
  {
    cacheScope: 'session',
    id: 'demo.tenant-policy',
    modelPosition: 'system prompt',
    phase: 'system',
    sourceType: 'system',
  },
  {
    cacheScope: 'session',
    id: 'demo.workspace-context',
    modelPosition: 'before first user',
    phase: 'stable-context',
    sourceType: 'knowledge',
  },
  {
    cacheScope: 'turn',
    id: 'demo.request-context',
    modelPosition: 'pinned to each user message',
    phase: 'user-augmentation',
    pinned: true,
    sourceType: 'runtime-state',
  },
  {
    cacheScope: 'turn',
    id: 'demo.runtime-tail',
    modelPosition: 'ephemeral tail message',
    phase: 'virtual-tail',
    sourceType: 'runtime-state',
  },
] as const;

const recordContextBuild = (
  context: MessagePipelineContext<
    AgentMessage,
    DemoInitialContext,
    DemoStepContext,
    DemoServices,
    DemoMetadata
  >,
  processorId: string,
  value: string,
): string => {
  context.services.recordContextBuild(processorId, value);
  return value;
};

class TenantPolicyProvider extends BaseSystemPromptProvider<
  AgentMessage,
  DemoInitialContext,
  DemoStepContext,
  DemoServices,
  DemoMetadata
> {
  readonly id = 'demo.tenant-policy';

  protected build(
    context: MessagePipelineContext<
      AgentMessage,
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >,
  ): string {
    return recordContextBuild(
      context,
      this.id,
      [
        '<tenant_policy>',
        `policy=${context.initial.policy}`,
        'constraint=do not place orders or claim execution without an explicit tool result',
        '</tenant_policy>',
      ].join('\n'),
    );
  }
}

class WorkspaceContextProvider extends BaseFirstUserContentProvider<
  AgentMessage,
  DemoInitialContext,
  DemoStepContext,
  DemoServices,
  DemoMetadata
> {
  readonly id = 'demo.workspace-context';

  constructor() {
    super({ sourceType: 'knowledge' });
  }

  protected build(
    context: MessagePipelineContext<
      AgentMessage,
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >,
  ): string {
    return recordContextBuild(
      context,
      this.id,
      [
        '<workspace_context>',
        `workspace=${context.initial.workspace}`,
        `experiment=${context.initial.experiment}`,
        `started_at=${context.initial.startedAt}`,
        'purpose=measure attributed prompt tokens, provider usage, cache reuse, and prefix integrity',
        '</workspace_context>',
      ].join('\n'),
    );
  }
}

class RequestContextProvider extends BasePinnedUserProvider<
  AgentMessage,
  DemoInitialContext,
  DemoStepContext,
  DemoServices,
  DemoMetadata
> {
  readonly id = 'demo.request-context';

  constructor() {
    super({ cacheScope: 'turn' });
  }

  protected build(
    context: MessagePipelineContext<
      AgentMessage,
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >,
  ): string {
    return recordContextBuild(
      context,
      this.id,
      [
        '<request_context>',
        `route=${context.step.route}`,
        `selection=${context.step.selection}`,
        `sent_at=${context.step.requestedAt}`,
        '</request_context>',
      ].join('\n'),
    );
  }
}

export const COLLAPSED_TOOL_RESULT_PREFIX = '[collapsed tool result]';

const toolResultText = (message: AgentMessage): string => {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '',
    )
    .join('');
};

export const isCollapsedToolResult = (message: AgentMessage): boolean =>
  (message as { role?: string }).role === 'toolResult' &&
  toolResultText(message).startsWith(COLLAPSED_TOOL_RESULT_PREFIX);

const collapseOlderToolResults = createToolResultRewriteProcessor<
  AgentMessage,
  DemoInitialContext,
  DemoStepContext,
  DemoServices,
  DemoMetadata
>(({ message, ordinal, total }) => {
  if (ordinal >= total - 1) return undefined;
  const text = toolResultText(message);
  const toolName = (message as { toolName?: string }).toolName ?? 'tool';
  const symbol = /"symbol":"([^"]+)"/u.exec(text)?.[1] ?? 'unknown';
  return `${COLLAPSED_TOOL_RESULT_PREFIX} ${toolName} for ${symbol}: ${text.length} chars superseded by a newer tool result; the model already answered from the full payload in an earlier turn.`;
});

class RuntimeTailProvider extends BaseVirtualTailProvider<
  AgentMessage,
  DemoInitialContext,
  DemoStepContext,
  DemoServices,
  DemoMetadata
> {
  readonly id = 'demo.runtime-tail';

  protected build(
    context: MessagePipelineContext<
      AgentMessage,
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >,
  ): string {
    return recordContextBuild(
      context,
      this.id,
      [
        '<runtime_state>',
        'provider=openrouter',
        `model=${context.step.modelId}`,
        `provider_turn=${context.step.providerTurn}`,
        `requested_at=${context.step.requestedAt}`,
        '</runtime_state>',
      ].join('\n'),
    );
  }
}

export const createDemoContextModule = (): MessageEngineModule<
  AgentMessage,
  DemoInitialContext,
  DemoStepContext,
  DemoServices,
  DemoMetadata
> => ({
  id: 'demo.business-context',
  processors: [
    new TenantPolicyProvider(),
    new WorkspaceContextProvider(),
    new RequestContextProvider(),
    new RuntimeTailProvider(),
    collapseOlderToolResults,
  ],
});

const CANDLE_COUNT = 30;

const seededSeries = (seed: string, count: number): number[] => {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const values: number[] = [];
  let price = 60 + (state % 400) / 4;
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    price = Math.max(1, price * (1 + ((state % 2001) - 1000) / 25000));
    values.push(Number(price.toFixed(2)));
  }
  return values;
};

export const marketSnapshotTool: AgentTool<ReturnType<typeof marketSnapshotParameters>> = {
  description:
    'Return the last 30 daily candles for a ticker as JSON. Deterministic synthetic data for the lab.',
  execute: async (_toolCallId, params) => {
    const symbol = params.symbol.trim().toUpperCase();
    const closes = seededSeries(symbol, CANDLE_COUNT);
    const candles = closes.map((close, index) => {
      const open = closes[index - 1] ?? close;
      const day = new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
      return {
        close,
        date: day,
        high: Number(Math.max(open, close) * 1.012).toFixed(2),
        low: Number(Math.min(open, close) * 0.988).toFixed(2),
        open,
        volume: 900_000 + ((index * 7919) % 400_000),
      };
    });
    const text = JSON.stringify({ candles, interval: '1d', source: 'lab-synthetic', symbol });
    return { content: [{ text, type: 'text' }], details: { symbol } };
  },
  label: 'Market Snapshot',
  name: 'market_snapshot',
  parameters: marketSnapshotParameters(),
};

function marketSnapshotParameters() {
  return Type.Object({
    symbol: Type.String({ description: 'Ticker symbol, for example MU.US' }),
  });
}

const replaceFirstUserContent = (messages: AgentMessage[], replacement: string): AgentMessage[] => {
  const index = messages.findIndex((message) => (message as { role?: string }).role === 'user');
  if (index === -1) throw new Error('The session has no committed user message to mutate');

  const message = messages[index];
  if (!message) throw new Error('The committed message is unavailable');
  const copy = structuredClone(message) as AgentMessage;
  const content = (copy as { content?: unknown }).content;
  if (typeof content === 'string') {
    (copy as { content: string }).content = replacement;
  } else if (Array.isArray(content)) {
    const textIndex = content.findIndex(
      (part) =>
        typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text',
    );
    if (textIndex === -1) throw new Error('The first user message has no mutable text part');
    const part = content[textIndex] as Record<string, unknown>;
    content[textIndex] = { ...part, text: replacement };
  } else {
    throw new Error('The first user message has unsupported content');
  }
  messages[index] = copy;
  return messages;
};

export const listDemoModels = (): DemoModelOption[] =>
  models
    .getModels('openrouter')
    .filter((model) => model.input.includes('text') && !model.id.endsWith(':batch'))
    .map((model) => ({
      cacheReadPerMillion: model.cost.cacheRead,
      contextWindow: model.contextWindow,
      id: model.id,
      inputPerMillion: model.cost.input,
      name: model.name,
      outputPerMillion: model.cost.output,
      reasoning: model.reasoning,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

export interface DemoSessionSnapshot {
  context: DemoSessionContextInput;
  contextBuildCounts: Record<string, number>;
  contextBuildValues: Record<string, string>;
  lastPrefixEvent?: PrefixMutationEvent;
  messages: AgentMessage[];
  modelId: string;
  providerTurn: number;
  sessionId: string;
  startedAt: string;
  strict: boolean;
}

export class DemoAgentSession {
  readonly instanceId: string;
  readonly modelId: string;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly strict: boolean;

  private active = false;
  private activeProviderTurnId: string | undefined;
  private activePublisher: Publish | undefined;
  private readonly contextBuildCounts = new Map<string, number>();
  private readonly contextBuildValues = new Map<string, string>();
  private readonly promptCacheBridge = createPiOpenRouterPromptCacheBridge();
  private readonly systemPromptBridge = createPiSystemPromptBridge(SYSTEM_PROMPT);
  private currentKey: string | undefined;
  private currentTurnContext: DemoTurnContextInput = {
    route: '/markets/MU.US',
    selection: 'MU.US · daily candle',
  };
  private currentTurnRequestedAt = new Date(0).toISOString();
  private readonly agent: Agent;
  private readonly engine;
  private lastPrefixEvent: PrefixMutationEvent | undefined;
  private latestCompiled: MessagesEngineResult<AgentMessage, DemoMetadata> | undefined;
  private latestSnapshot: TurnTokenSnapshot | undefined;
  private providerTurn = 0;
  private readonly sessionContext: DemoSessionContextInput;

  constructor(input: {
    context?: DemoSessionContextInput;
    modelId: string;
    sessionId: string;
    startedAt?: string;
    strict: boolean;
  }) {
    const model = getOpenRouterModel(input.modelId);
    this.modelId = input.modelId;
    this.sessionId = input.sessionId;
    this.sessionContext = {
      policy: input.context?.policy ?? 'research-only',
      workspace: input.context?.workspace ?? 'Kansoku Trading Desk',
    };
    this.startedAt = input.startedAt ?? new Date().toISOString();
    this.strict = input.strict;

    this.engine = createPiMessageEngine<
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >({
      baseSystemPrompt: SYSTEM_PROMPT,
      createMetadata: () => ({ experiment: 'openrouter-real-agent' }),
      hooks: {
        onPrefixMutation: (event) => {
          this.lastPrefixEvent = event;
          this.activePublisher?.({ event, type: 'prefix-mutation' });
        },
        onTurnCompiled: (snapshot) => {
          this.latestSnapshot = snapshot;
          const summary = this.engine.getTokenSummary();
          this.activePublisher?.({
            contextStages: this.contextStages(snapshot),
            snapshot,
            ...(summary ? { summary } : {}),
            type: 'token-snapshot',
          });
        },
      },
      initial: {
        experiment: 'Pi adapter / OpenRouter telemetry validation',
        policy: this.sessionContext.policy,
        startedAt: this.startedAt,
        workspace: this.sessionContext.workspace,
      },
      logger: {
        error: (message) => this.activePublisher?.({ message, type: 'trace' }),
        warn: (message) => this.activePublisher?.({ message, type: 'trace' }),
      },
      modules: [createDemoContextModule()],
      services: {
        recordContextBuild: (processorId, value) => {
          this.contextBuildCounts.set(
            processorId,
            (this.contextBuildCounts.get(processorId) ?? 0) + 1,
          );
          this.contextBuildValues.set(processorId, value);
        },
      },
      sessionId: this.sessionId,
      strict: this.strict,
      tokenAccounting: {
        pricing: {
          resolve: () => ({
            cacheReadPerMillion: model.cost.cacheRead,
            cacheWritePerMillion: model.cost.cacheWrite,
            currency: 'USD',
            inputPerMillion: model.cost.input,
            outputPerMillion: model.cost.output,
            version: `pi-ai-openrouter-catalog@0.84.1/${model.id}`,
          }),
        },
        retainTurns: 50,
        tokenizer: {
          accuracy: model.id.startsWith('openai/') ? 'exact' : 'estimated',
          count: (content) => countTokens(content),
          id: 'gpt-tokenizer/o200k-base@3.4.0',
        },
      },
    });
    this.instanceId = this.engine.instanceId;

    this.agent = new Agent({
      getApiKey: () => this.currentKey,
      initialState: {
        messages: [],
        model,
        systemPrompt: SYSTEM_PROMPT,
        tools: [marketSnapshotTool],
      },
      onPayload: (payload) => this.promptCacheBridge.apply(payload),
      sessionId: this.sessionId,
      streamFn: (requestModel, context, options) =>
        models.streamSimple(requestModel, this.systemPromptBridge.apply(context), {
          ...options,
          maxTokens: Math.min(options?.maxTokens ?? 128, 128),
        }),
      transformContext: this.engine.createTransformContext({
        onCompiled: (result) => {
          this.latestCompiled = result;
          this.systemPromptBridge.capture(result);
          this.promptCacheBridge.capture(result);
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.activePublisher?.({ message: `Transform fallback: ${message}`, type: 'trace' });
        },
        runtime: { model: this.modelId, provider: 'openrouter' },
        step: () => ({
          ...this.currentTurnContext,
          modelId: this.modelId,
          providerTurn: this.providerTurn,
          requestedAt: this.currentTurnRequestedAt,
        }),
        turnId: () => {
          this.providerTurn += 1;
          const turnId = `${this.sessionId}:provider-${this.providerTurn}`;
          this.activeProviderTurnId = turnId;
          return turnId;
        },
      }),
    });
    this.agent.subscribe((event) => this.handleAgentEvent(event));
  }

  static async fromSnapshot(snapshot: DemoSessionSnapshot): Promise<DemoAgentSession> {
    const session = new DemoAgentSession({
      context: snapshot.context,
      modelId: snapshot.modelId,
      sessionId: snapshot.sessionId,
      startedAt: snapshot.startedAt,
      strict: snapshot.strict,
    });
    await session.restore(snapshot);
    return session;
  }

  abort(): void {
    this.agent.abort();
  }

  async destroy(): Promise<SessionTokenSummary> {
    this.agent.abort();
    return this.engine.destroy();
  }

  state(): DemoSessionState {
    const summary = this.engine.getTokenSummary();
    return {
      cacheIdentity: this.engine.cacheIdentity,
      contextStages: this.contextStages(),
      generation: this.engine.generation,
      instanceId: this.instanceId,
      messages: this.agent.state.messages.map(toDemoMessageView),
      modelId: this.modelId,
      sessionId: this.sessionId,
      strict: this.strict,
      ...(summary ? { summary } : {}),
      toolResults: this.toolResultStats(),
    };
  }

  private toolResultStats(): DemoSessionState['toolResults'] {
    const compiled = this.latestCompiled?.messages ?? [];
    const results = compiled.filter(
      (message) => (message as { role?: string }).role === 'toolResult',
    );
    return {
      collapsed: results.filter(isCollapsedToolResult).length,
      total: results.length,
    };
  }

  async restore(snapshot: DemoSessionSnapshot): Promise<void> {
    this.providerTurn = snapshot.providerTurn;
    this.lastPrefixEvent = snapshot.lastPrefixEvent;
    this.contextBuildCounts.clear();
    this.contextBuildValues.clear();
    for (const [processorId, count] of Object.entries(snapshot.contextBuildCounts)) {
      this.contextBuildCounts.set(processorId, count);
    }
    for (const [processorId, value] of Object.entries(snapshot.contextBuildValues)) {
      this.contextBuildValues.set(processorId, value);
    }
    const messages = structuredClone(snapshot.messages);
    this.agent.state.messages = messages;
    if (messages.length > 0) await this.engine.syncTranscript(messages);
  }

  toSnapshot(): DemoSessionSnapshot {
    return {
      context: this.sessionContext,
      contextBuildCounts: Object.fromEntries(this.contextBuildCounts),
      contextBuildValues: Object.fromEntries(this.contextBuildValues),
      ...(this.lastPrefixEvent ? { lastPrefixEvent: this.lastPrefixEvent } : {}),
      messages: structuredClone(this.agent.state.messages),
      modelId: this.modelId,
      providerTurn: this.providerTurn,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      strict: this.strict,
    };
  }

  async mutatePrefix(replacement: string): Promise<DemoMutationResult> {
    if (this.active) throw new Error('Cannot mutate the prefix during an active turn');
    const messages = replaceFirstUserContent(
      structuredClone(this.agent.state.messages),
      replacement,
    );
    this.lastPrefixEvent = undefined;

    try {
      await this.engine.syncTranscript(messages);
      this.agent.state.messages = messages;
      return {
        accepted: true,
        ...(this.lastPrefixEvent ? { event: this.lastPrefixEvent } : {}),
        state: this.state(),
      };
    } catch (error) {
      if (!(error instanceof PrefixMutationError)) throw error;
      return {
        accepted: false,
        event: error.event,
        state: this.state(),
      };
    }
  }

  async runTurn(
    prompt: string,
    key: string,
    context: DemoTurnContextInput,
    publish: Publish,
  ): Promise<void> {
    if (this.active) throw new Error('A provider turn is already active');
    if (!prompt.trim()) throw new Error('Prompt is required');
    if (!key.trim()) throw new Error('OpenRouter API key is required');

    this.active = true;
    this.activePublisher = publish;
    this.currentKey = key.trim();
    this.currentTurnContext = context;
    this.currentTurnRequestedAt = new Date().toISOString();
    publish({ state: this.state(), type: 'turn-start' });

    try {
      await this.agent.prompt(prompt.trim());
      publish({ state: this.state(), type: 'done' });
    } finally {
      this.active = false;
      this.activeProviderTurnId = undefined;
      this.activePublisher = undefined;
      this.currentKey = undefined;
    }
  }

  private async handleAgentEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'message_update') {
      if (event.assistantMessageEvent.type === 'text_delta') {
        this.activePublisher?.({ delta: event.assistantMessageEvent.delta, type: 'text-delta' });
      }
      return;
    }
    if (event.type !== 'message_end') return;
    if ((event.message as { role?: string }).role !== 'assistant') return;

    const assistant = event.message as AssistantMessage;
    const turnId = this.activeProviderTurnId;
    if (turnId) {
      const usage = normalizePiUsage(assistant.usage);
      try {
        this.latestSnapshot = await this.engine.recordUsage(turnId, usage);
        this.activePublisher?.({
          cacheReadCost: assistant.usage.cost.cacheRead,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteCost: assistant.usage.cost.cacheWrite,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          inputCost: assistant.usage.cost.input,
          inputTokens: usage.inputTokens,
          modelId: this.modelId,
          outputCost: assistant.usage.cost.output,
          outputTokens: usage.outputTokens,
          ...(usage.reasoningTokens === undefined
            ? {}
            : { reasoningTokens: usage.reasoningTokens }),
          totalCost: usage.totalCost ?? 0,
          turnId,
          type: 'provider-usage',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.activePublisher?.({ message: `Usage correlation skipped: ${message}`, type: 'trace' });
      }
    }
    const message = toDemoMessageView(assistant, this.agent.state.messages.length);
    this.activePublisher?.({ message, type: 'assistant-final' });

    if (assistant.stopReason === 'error' || assistant.stopReason === 'aborted') {
      this.activePublisher?.({
        message: assistant.errorMessage ?? `Provider stopped with ${assistant.stopReason}`,
        type: 'error',
      });
    }
  }

  private contextStages(
    snapshot: TurnTokenSnapshot | undefined = this.latestSnapshot,
  ): DemoContextStageState[] {
    return DEMO_CONTEXT_STAGES.map((stage) => {
      const segments =
        snapshot?.segments.filter((segment) => segment.processorId === stage.id) ?? [];
      const buildCount = this.contextBuildCounts.get(stage.id) ?? 0;
      const cacheStatus = segments[0]?.cacheStatus;
      const value = this.contextBuildValues.get(stage.id);
      return {
        buildCount,
        cacheScope: stage.cacheScope,
        ...(cacheStatus ? { cacheStatus } : {}),
        id: stage.id,
        modelPosition: stage.modelPosition,
        phase: stage.phase,
        ...('pinned' in stage ? { pinCount: segments.length } : {}),
        replayed:
          stage.cacheScope === 'session' && this.providerTurn > 0 && buildCount < this.providerTurn,
        sourceType: stage.sourceType,
        tokens: segments.reduce((total, segment) => total + segment.tokens, 0),
        ...(value ? { value } : {}),
      };
    });
  }
}

export const hasEnvironmentOpenRouterKey = (): boolean =>
  Boolean(process.env.OPENROUTER_API_KEY?.trim());
