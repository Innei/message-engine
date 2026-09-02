import { ConcurrentCompilationError, EngineDestroyedError, PrefixMutationError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import type { LastUserPin } from './last-user-pin.js';
import type { MessageAdapter } from './message-adapter.js';
import { messageToTokenSegments } from './message-adapter.js';
import { MessageIndex } from './message-index.js';
import { executePipeline, PipelineExecutionContext, PipelinePlan } from './pipeline.js';
import { TokenAccountingManager } from './token-accounting.js';
import type {
  NormalizedUsage,
  SessionTokenSummary,
  TokenizerSegment,
  TurnTokenSnapshot,
} from './token-types.js';
import type {
  CompileTurnOptions,
  ContextContribution,
  CreateTransformContextOptions,
  EngineLogger,
  MessagesEngineResult,
  PrefixInvalidationInput,
  PrefixMutationEvent,
  PrefixMutationReason,
  SessionMessagesEngineHooks,
  SessionMessagesEngineOptions,
  SyncTranscriptOptions,
} from './types.js';

let fallbackInstanceSequence = 0;

const createInstanceId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackInstanceSequence += 1;
  return `message-engine-${Date.now()}-${fallbackInstanceSequence}`;
};

const emptySummary = (
  sessionId: string,
  instanceId: string,
  generation: number,
  prefixViolations: number,
): SessionTokenSummary => ({
  generations: generation + 1,
  instanceId,
  prefixViolations,
  sessionId,
  sources: [],
  totalCacheReadTokens: 0,
  totalCacheWriteTokens: 0,
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  turns: [],
});

const contributionSegment = (contribution: ContextContribution): TokenizerSegment => ({
  cacheScope: contribution.content.cacheScope,
  content: contribution.content.text,
  contentDigest: fingerprint(contribution.content.text),
  framingType: `contribution:${contribution.slot}`,
  ...(contribution.content.messageId ? { messageId: contribution.content.messageId } : {}),
  moduleId: contribution.content.moduleId,
  processorId: contribution.content.processorId,
  segmentId: contribution.content.id,
  sourceType: contribution.content.sourceType,
});

export class SessionMessagesEngine<
  Message,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly adapter: MessageAdapter<Message>;
  readonly instanceId = createInstanceId();
  readonly pipelineHash: string;
  readonly sessionId: string;
  readonly strict: boolean;

  private activeCompilation: Promise<MessagesEngineResult<Message, Metadata>> | undefined;
  private activeController: AbortController | undefined;
  private readonly baseSystemPrompt: string;
  private readonly createMetadata: (() => Metadata) | undefined;
  private destroyPromise: Promise<SessionTokenSummary> | undefined;
  private destroyed = false;
  private generationValue = 0;
  private readonly hooks: SessionMessagesEngineHooks;
  private readonly index: MessageIndex<Message>;
  private readonly initial: Initial;
  private readonly inputReferences: Message[] = [];
  private lastCompiledGeneration = -1;
  private lastCompiledMessageCount = 0;
  private readonly lastUserPins = new Map<string, LastUserPin>();
  private readonly logger: EngineLogger;
  private messageSequence = 0;
  private prefixViolationCount = 0;
  private readonly rawFingerprints: string[] = [];
  private readonly rawMessageIds: string[] = [];
  private readonly rawMessages: Message[] = [];
  private readonly rawTokenSegments: TokenizerSegment[] = [];
  private readonly sessionContributionCache = new Map<string, ContextContribution[]>();
  private readonly services: Services;
  private readonly strictHooks: boolean;
  private readonly tokenAccounting?: TokenAccountingManager;
  private readonly toolResultPins = new Map<string, Message>();
  private turnSequence = 0;
  private readonly plan: PipelinePlan<Message, Initial, Step, Services, Metadata>;

  constructor(options: SessionMessagesEngineOptions<Message, Initial, Step, Services, Metadata>) {
    this.adapter = options.adapter;
    this.baseSystemPrompt = options.baseSystemPrompt ?? '';
    this.createMetadata = options.createMetadata;
    this.hooks = options.hooks ?? {};
    this.index = new MessageIndex(options.adapter);
    this.initial = options.initial;
    this.logger = options.logger ?? console;
    this.plan = new PipelinePlan(options.modules ?? []);
    this.pipelineHash = this.plan.pipelineHash;
    this.sessionId = options.sessionId;
    this.services = options.services;
    this.strict = options.strict ?? false;
    this.strictHooks = options.strictHooks ?? false;
    if (options.tokenAccounting) {
      this.tokenAccounting = new TokenAccountingManager(
        this.sessionId,
        this.instanceId,
        options.tokenAccounting,
      );
    }
  }

  get cacheIdentity(): string {
    return `${this.sessionId}:${this.instanceId}:g${this.generationValue}:${this.pipelineHash}`;
  }

  get generation(): number {
    return this.generationValue;
  }

  get length(): number {
    return this.rawMessages.length;
  }

  append(messages: readonly Message[]): void {
    this.assertActive();
    this.assertTranscriptMutable();
    for (const input of messages) {
      const message = this.adapter.clone(input);
      const messageFingerprint = this.adapter.fingerprint(message);
      const messageId = `message:${this.messageSequence}:${messageFingerprint}`;
      const index = this.rawMessages.length;
      this.messageSequence += 1;
      this.rawMessages.push(message);
      this.rawFingerprints.push(messageFingerprint);
      this.rawMessageIds.push(messageId);
      this.inputReferences.push(input);
      this.rawTokenSegments.push(...messageToTokenSegments(this.adapter, message, messageId));
      this.index.append(message, messageId, index);
    }
  }

  async compileTurn(
    compileOptions: CompileTurnOptions<Step>,
  ): Promise<MessagesEngineResult<Message, Metadata>> {
    this.assertActive();
    if (this.activeCompilation) throw new ConcurrentCompilationError(this.sessionId);

    const controller = new AbortController();
    this.activeController = controller;
    const signal = compileOptions.signal
      ? AbortSignal.any([controller.signal, compileOptions.signal])
      : controller.signal;
    const compilation = this.executeCompile(compileOptions, signal).finally(() => {
      if (this.activeCompilation === compilation) this.activeCompilation = undefined;
      if (this.activeController === controller) this.activeController = undefined;
    });
    this.activeCompilation = compilation;
    return compilation;
  }

  createTransformContext(
    adapterOptions: CreateTransformContextOptions<Message, Step, Metadata>,
  ): (messages: Message[], signal?: AbortSignal) => Promise<Message[]> {
    return async (messages, signal) => {
      try {
        await this.syncTranscript(messages, {
          trustMessageIdentity: adapterOptions.trustMessageIdentity ?? false,
        });
        const turnId =
          typeof adapterOptions.turnId === 'function'
            ? adapterOptions.turnId()
            : adapterOptions.turnId;
        const step =
          typeof adapterOptions.step === 'function'
            ? (adapterOptions.step as (messages: readonly Message[]) => Step)(messages)
            : adapterOptions.step;
        const result = await this.compileTurn({
          ...(adapterOptions.runtime ? { runtime: adapterOptions.runtime } : {}),
          ...(signal ? { signal } : {}),
          step,
          ...(turnId ? { turnId } : {}),
        });
        try {
          await adapterOptions.onCompiled?.(result);
        } catch (hookError) {
          this.logger.error?.('Message transform compiled hook failed', {
            error: hookError instanceof Error ? hookError.message : String(hookError),
            instanceId: this.instanceId,
            sessionId: this.sessionId,
          });
          if (this.strictHooks) throw hookError;
        }
        return result.messages;
      } catch (error) {
        this.logger.error?.('Message transform failed; returning the original transcript', {
          error: error instanceof Error ? error.message : String(error),
          instanceId: this.instanceId,
          sessionId: this.sessionId,
        });
        try {
          await adapterOptions.onError?.(error);
        } catch (hookError) {
          this.logger.error?.('Message transform error hook failed', {
            error: hookError instanceof Error ? hookError.message : String(hookError),
          });
        }
        return messages;
      }
    };
  }

  destroy(): Promise<SessionTokenSummary> {
    if (this.destroyPromise) return this.destroyPromise;
    if (this.destroyed) {
      return Promise.resolve(
        emptySummary(
          this.sessionId,
          this.instanceId,
          this.generationValue,
          this.prefixViolationCount,
        ),
      );
    }
    const promise = this.executeDestroy().finally(() => {
      if (this.destroyPromise === promise) this.destroyPromise = undefined;
    });
    this.destroyPromise = promise;
    return promise;
  }

  private async executeDestroy(): Promise<SessionTokenSummary> {
    this.destroyed = true;
    this.activeController?.abort(new Error('Message engine destroyed'));
    const errors: unknown[] = [];

    if (this.activeCompilation) {
      try {
        await this.activeCompilation;
      } catch {
        // An aborted in-flight compilation is expected during teardown.
      }
    }

    let summary = emptySummary(
      this.sessionId,
      this.instanceId,
      this.generationValue,
      this.prefixViolationCount,
    );
    if (this.tokenAccounting) {
      summary = this.tokenAccounting.summary();
      try {
        await this.tokenAccounting.destroy();
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      await this.invokeHook('onSessionSummary', summary);
    } catch (error) {
      errors.push(error);
    }

    for (const module of [...this.plan.modules].reverse()) {
      try {
        await module.teardown?.();
      } catch (error) {
        errors.push(error);
      }
    }

    this.rawMessages.length = 0;
    this.rawFingerprints.length = 0;
    this.rawMessageIds.length = 0;
    this.rawTokenSegments.length = 0;
    this.inputReferences.length = 0;
    this.index.clear();
    this.clearGenerationCaches();

    if (errors.length > 0) throw new AggregateError(errors, 'Message engine teardown failed');
    return summary;
  }

  getIndex() {
    this.assertActive();
    return this.index.snapshot();
  }

  getMessages(): Message[] {
    this.assertActive();
    return this.rawMessages.map((message) => this.adapter.clone(message));
  }

  getTokenSummary(): SessionTokenSummary | undefined {
    this.assertActive();
    return this.tokenAccounting?.summary();
  }

  async invalidatePrefix(input: PrefixInvalidationInput): Promise<void> {
    this.assertActive();
    this.assertTranscriptMutable();
    await this.handlePrefixMutation(
      input.firstChangedIndex ?? 0,
      input.reason,
      input.expected ?? false,
      input.processorId,
    );
  }

  async recordUsage(turnId: string, usage: NormalizedUsage): Promise<TurnTokenSnapshot> {
    this.assertActive();
    if (!this.tokenAccounting) {
      throw new Error('Token accounting is not configured for this engine');
    }
    return this.tokenAccounting.recordUsage(turnId, usage);
  }

  async process(
    messages: readonly Message[],
    compileOptions: CompileTurnOptions<Step>,
    syncOptions: SyncTranscriptOptions = {},
  ): Promise<MessagesEngineResult<Message, Metadata>> {
    await this.syncTranscript(messages, syncOptions);
    return this.compileTurn(compileOptions);
  }

  async syncTranscript(
    messages: readonly Message[],
    syncOptions: SyncTranscriptOptions = {},
  ): Promise<void> {
    this.assertActive();
    this.assertTranscriptMutable();
    const sharedLength = Math.min(messages.length, this.rawMessages.length);

    if (
      syncOptions.trustMessageIdentity &&
      this.rawMessages.length > 0 &&
      messages.length >= this.rawMessages.length &&
      Object.is(
        messages[this.rawMessages.length - 1],
        this.inputReferences[this.rawMessages.length - 1],
      )
    ) {
      if (messages.length > this.rawMessages.length) {
        this.append(messages.slice(this.rawMessages.length));
      }
      return;
    }

    let firstChangedIndex = sharedLength;
    const nextFingerprints = new Array<string>(messages.length);

    for (let index = 0; index < sharedLength; index += 1) {
      const input = messages[index];
      if (input === undefined) continue;
      if (syncOptions.trustMessageIdentity && Object.is(input, this.inputReferences[index])) {
        nextFingerprints[index] = this.rawFingerprints[index] ?? this.adapter.fingerprint(input);
        continue;
      }
      const nextFingerprint = this.adapter.fingerprint(input);
      nextFingerprints[index] = nextFingerprint;
      if (nextFingerprint !== this.rawFingerprints[index]) {
        firstChangedIndex = index;
        break;
      }
    }

    if (firstChangedIndex === sharedLength && messages.length >= this.rawMessages.length) {
      if (messages.length > this.rawMessages.length) {
        this.append(messages.slice(this.rawMessages.length));
      } else {
        for (let index = 0; index < messages.length; index += 1) {
          const message = messages[index];
          if (message !== undefined) this.inputReferences[index] = message;
        }
      }
      return;
    }

    const reason = this.classifyMutation(messages, nextFingerprints, firstChangedIndex);
    await this.handlePrefixMutation(firstChangedIndex, reason, syncOptions.expected ?? false);

    const clonedMessages = messages.map((message) => this.adapter.clone(message));
    this.rawMessages.length = 0;
    this.rawMessages.push(...clonedMessages);
    this.rawFingerprints.length = 0;
    this.rawMessageIds.length = 0;
    this.rawTokenSegments.length = 0;
    this.inputReferences.length = 0;
    this.index.clear();
    for (let index = 0; index < clonedMessages.length; index += 1) {
      const message = clonedMessages[index];
      const input = messages[index];
      if (message === undefined || input === undefined) continue;
      const messageFingerprint = this.adapter.fingerprint(message);
      const messageId = `message:${this.messageSequence}:${messageFingerprint}`;
      this.messageSequence += 1;
      this.rawFingerprints.push(messageFingerprint);
      this.rawMessageIds.push(messageId);
      this.rawTokenSegments.push(...messageToTokenSegments(this.adapter, message, messageId));
      this.inputReferences.push(input);
      this.index.append(message, messageId, index);
    }
  }

  private assertActive(): void {
    if (this.destroyed) throw new EngineDestroyedError(this.sessionId);
  }

  private assertTranscriptMutable(): void {
    if (this.activeCompilation) throw new ConcurrentCompilationError(this.sessionId);
  }

  private classifyMutation(
    messages: readonly Message[],
    nextFingerprints: readonly string[],
    firstChangedIndex: number,
  ): PrefixMutationReason {
    if (messages.length < this.rawMessages.length && firstChangedIndex === messages.length) {
      return 'message-removed';
    }
    const previous = this.rawMessages[firstChangedIndex];
    const next = messages[firstChangedIndex];
    if (previous !== undefined && next !== undefined) {
      if (this.adapter.getRole(previous) !== this.adapter.getRole(next)) return 'role-changed';
      const nextFingerprint = nextFingerprints[firstChangedIndex] ?? this.adapter.fingerprint(next);
      if (this.rawFingerprints.slice(firstChangedIndex + 1).includes(nextFingerprint)) {
        return 'message-reordered';
      }
    }
    if (messages.length > this.rawMessages.length) return 'message-inserted';
    if (messages.length < this.rawMessages.length) return 'message-removed';
    return 'content-changed';
  }

  private async executeCompile(
    compileOptions: CompileTurnOptions<Step>,
    signal: AbortSignal,
  ): Promise<MessagesEngineResult<Message, Metadata>> {
    const startedAt = performance.now();
    const metadata = this.createMetadata?.() ?? ({} as Metadata);
    const context = new PipelineExecutionContext(
      this.adapter,
      this.rawMessages,
      this.rawMessageIds,
      this.initial,
      compileOptions.step,
      this.services,
      metadata,
      this.baseSystemPrompt,
      signal,
      this.index.snapshot(),
      this.lastCompiledMessageCount,
      this.lastUserPins,
      this.toolResultPins,
    );
    const processorStats = await executePipeline({
      context,
      plan: this.plan,
      sessionContributionCache: this.sessionContributionCache,
    });
    signal.throwIfAborted();

    const reusedMessages =
      this.lastCompiledGeneration === this.generationValue
        ? Math.min(this.lastCompiledMessageCount, this.rawMessages.length)
        : 0;
    const internalPrefixReuseRatio =
      this.rawMessages.length === 0 ? 1 : reusedMessages / this.rawMessages.length;
    const turnId =
      compileOptions.turnId ?? `${this.instanceId}:g${this.generationValue}:t${this.turnSequence}`;
    this.turnSequence += 1;
    let tokenSnapshot: TurnTokenSnapshot | undefined;
    if (this.tokenAccounting) {
      const segments = [...this.rawTokenSegments];
      if (this.baseSystemPrompt) {
        segments.unshift({
          cacheScope: 'session',
          content: this.baseSystemPrompt,
          contentDigest: fingerprint(this.baseSystemPrompt),
          framingType: 'system:base',
          moduleId: 'engine',
          processorId: 'base-system-prompt',
          segmentId: 'engine:base-system-prompt',
          sourceType: 'system',
        });
      }
      segments.push(...context.appliedContributions().map(contributionSegment));
      tokenSnapshot = await this.tokenAccounting.measureTurn({
        generation: this.generationValue,
        internalPrefixReuseRatio,
        ...(compileOptions.runtime ? { runtime: compileOptions.runtime } : {}),
        segments,
        signal,
        turnId,
      });
      await this.invokeHook('onTurnCompiled', tokenSnapshot);
    }

    this.lastCompiledGeneration = this.generationValue;
    this.lastCompiledMessageCount = this.rawMessages.length;
    return {
      generation: this.generationValue,
      messages: context.snapshotMessages(),
      metadata,
      stats: {
        durationMs: performance.now() - startedAt,
        internalPrefixReuseRatio,
        processors: processorStats,
      },
      systemPrompt: context.systemPrompt,
      ...(tokenSnapshot ? { tokenSnapshot } : {}),
    };
  }

  private async handlePrefixMutation(
    firstChangedIndex: number,
    reason: PrefixMutationReason,
    expected: boolean,
    processorId?: string,
  ): Promise<void> {
    const event: PrefixMutationEvent = {
      action: this.strict ? 'blocked' : 'accepted-and-invalidated',
      committedBoundary: this.rawMessages.length,
      expected,
      firstChangedIndex,
      instanceId: this.instanceId,
      ...(this.rawMessageIds[firstChangedIndex]
        ? { messageId: this.rawMessageIds[firstChangedIndex] }
        : {}),
      nextGeneration: this.generationValue + 1,
      previousGeneration: this.generationValue,
      ...(processorId ? { processorId } : {}),
      reason,
      sessionId: this.sessionId,
      strict: this.strict,
    };
    this.prefixViolationCount += 1;
    this.tokenAccounting?.notePrefixViolation();
    this.logger.warn?.('Committed message prefix mutation detected', { ...event });
    await this.invokeHook('onPrefixMutation', event);

    if (this.strict) throw new PrefixMutationError(event);
    this.generationValue += 1;
    this.lastCompiledGeneration = -1;
    this.lastCompiledMessageCount = 0;
    this.clearGenerationCaches();
  }

  private clearGenerationCaches(): void {
    this.sessionContributionCache.clear();
    this.lastUserPins.clear();
    this.toolResultPins.clear();
  }

  private async invokeHook(name: 'onPrefixMutation', value: PrefixMutationEvent): Promise<void>;
  private async invokeHook(name: 'onSessionSummary', value: SessionTokenSummary): Promise<void>;
  private async invokeHook(name: 'onTurnCompiled', value: TurnTokenSnapshot): Promise<void>;
  private async invokeHook(
    name: keyof SessionMessagesEngineHooks,
    value: PrefixMutationEvent | SessionTokenSummary | TurnTokenSnapshot,
  ): Promise<void> {
    try {
      if (name === 'onPrefixMutation') {
        await this.hooks.onPrefixMutation?.(value as PrefixMutationEvent);
      } else if (name === 'onSessionSummary') {
        await this.hooks.onSessionSummary?.(value as SessionTokenSummary);
      } else {
        await this.hooks.onTurnCompiled?.(value as TurnTokenSnapshot);
      }
    } catch (error) {
      this.logger.error?.(`Message engine hook ${name} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.strictHooks) throw error;
    }
  }
}
