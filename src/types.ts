import type { MessageAdapter } from './message-adapter.js';
import type {
  RuntimeIdentity,
  SessionTokenSummary,
  TokenAccountingOptions,
  TokenCacheScope,
  TokenSourceType,
  TurnTokenSnapshot,
} from './token-types.js';

export type Awaitable<T> = Promise<T> | T;

export const PIPELINE_PHASES = [
  'sanitize',
  'history',
  'system',
  'stable-context',
  'user-augmentation',
  'virtual-tail',
  'transform',
  'content',
  'finalize',
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

export type ContributionSlot = 'last-user' | 'stable-prefix' | 'system' | 'virtual-tail';

export interface AttributedContent {
  cacheScope: TokenCacheScope;
  derivedFrom?: string[];
  id: string;
  messageId?: string;
  moduleId: string;
  processorId: string;
  sourceType: TokenSourceType;
  text: string;
}

export interface ContextContribution {
  content: AttributedContent;
  order?: number;
  slot: ContributionSlot;
}

export interface ContextContributionInput {
  content: Omit<AttributedContent, 'moduleId' | 'processorId'> & {
    moduleId?: string;
    processorId?: string;
  };
  order?: number;
  slot: ContributionSlot;
}

export interface MessageIndexSnapshot {
  byId: ReadonlyMap<string, number>;
  byRole: ReadonlyMap<string, readonly number[]>;
  firstUser: number | null;
  lastAssistant: number | null;
  lastUser: number | null;
  toolCallById: ReadonlyMap<string, { messageIndex: number; toolName: string }>;
  toolResultByCallId: ReadonlyMap<string, number>;
}

export interface MessagePipelineContext<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly initial: Initial;
  readonly rawMessages: readonly Message[];
  readonly services: Services;
  readonly signal: AbortSignal | undefined;
  readonly step: Step;

  readonly aborted: boolean;
  readonly abortReason: string | undefined;
  readonly index: MessageIndexSnapshot;
  readonly messages: readonly Message[];
  readonly metadata: Metadata;
  readonly systemPrompt: string;

  abort(reason: string): void;
  appendMessages(messages: readonly Message[]): void;
  contribute(contribution: ContextContributionInput): void;
  replaceMessage(index: number, message: Message): void;
  replaceMessages(messages: readonly Message[]): void;
  setMetadata<Key extends keyof Metadata>(key: Key, value: Metadata[Key]): void;
  setSystemPrompt(systemPrompt: string): void;
}

export interface ProcessorAccess {
  reads?: ReadonlyArray<'all' | 'content' | 'ids' | 'roles' | 'tool-calls'>;
  writes?: 'content' | 'none' | 'structure';
}

export interface MessageProcessor<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly access?: ProcessorAccess;
  readonly after?: readonly string[];
  readonly before?: readonly string[];
  readonly cacheScope?: 'session' | 'turn';
  readonly id: string;
  readonly phase: PipelinePhase;

  enabled?(context: MessagePipelineContext<Message, Initial, Step, Services, Metadata>): boolean;
  process(
    context: MessagePipelineContext<Message, Initial, Step, Services, Metadata>,
  ): Awaitable<void>;
}

export interface MessageEngineModule<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly processors: ReadonlyArray<MessageProcessor<Message, Initial, Step, Services, Metadata>>;
  teardown?(): Awaitable<void>;
}

export type PrefixMutationReason =
  | 'content-changed'
  | 'message-inserted'
  | 'message-removed'
  | 'message-reordered'
  | 'pipeline-changed'
  | 'role-changed'
  | 'stable-provider-changed';

export interface PrefixMutationEvent {
  action: 'accepted-and-invalidated' | 'blocked';
  committedBoundary: number;
  expected: boolean;
  firstChangedIndex: number;
  instanceId: string;
  messageId?: string;
  nextGeneration: number;
  previousGeneration: number;
  processorId?: string;
  reason: PrefixMutationReason;
  sessionId: string;
  strict: boolean;
}

export interface PrefixInvalidationInput {
  expected?: boolean;
  firstChangedIndex?: number;
  processorId?: string;
  reason: PrefixMutationReason;
}

export interface EngineLogger {
  debug?(message: string, details?: Record<string, unknown>): void;
  error?(message: string, details?: Record<string, unknown>): void;
  warn?(message: string, details?: Record<string, unknown>): void;
}

export interface SessionMessagesEngineHooks {
  onPrefixMutation?(event: PrefixMutationEvent): Awaitable<void>;
  onSessionSummary?(summary: SessionTokenSummary): Awaitable<void>;
  onTurnCompiled?(snapshot: TurnTokenSnapshot): Awaitable<void>;
}

export interface SessionMessagesEngineOptions<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  baseSystemPrompt?: string;
  createMetadata?: () => Metadata;
  adapter: MessageAdapter<Message>;
  hooks?: SessionMessagesEngineHooks;
  initial: Initial;
  logger?: EngineLogger;
  modules?: ReadonlyArray<MessageEngineModule<Message, Initial, Step, Services, Metadata>>;
  services: Services;
  sessionId: string;
  strict?: boolean;
  strictHooks?: boolean;
  tokenAccounting?: TokenAccountingOptions;
}

export interface CompileTurnOptions<Step> {
  runtime?: RuntimeIdentity;
  signal?: AbortSignal;
  step: Step;
  turnId?: string;
}

export interface SyncTranscriptOptions {
  expected?: boolean;
  trustMessageIdentity?: boolean;
}

export interface CreateTransformContextOptions<
  Message,
  Step,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  onCompiled?(result: MessagesEngineResult<Message, Metadata>): Awaitable<void>;
  onError?(error: unknown): Awaitable<void>;
  runtime?: RuntimeIdentity;
  step: Step | ((messages: readonly Message[]) => Step);
  turnId?: string | (() => string);
  trustMessageIdentity?: boolean;
}

export interface ProcessorStats {
  durationMs: number;
  id: string;
  phase: PipelinePhase;
  replayedFromCache: boolean;
}

export interface MessagesEngineResult<Message, Metadata extends Record<string, unknown>> {
  generation: number;
  messages: Message[];
  metadata: Metadata;
  stats: {
    durationMs: number;
    internalPrefixReuseRatio: number;
    processors: ProcessorStats[];
  };
  systemPrompt: string;
  tokenSnapshot?: TurnTokenSnapshot;
}
