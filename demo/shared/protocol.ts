import type {
  PipelinePhase,
  PrefixMutationEvent,
  SegmentTokenRecord,
  SessionTokenSummary,
  TurnTokenSnapshot,
} from '../../src/index.js';

export interface DemoSessionContextInput {
  policy: string;
  workspace: string;
}

export interface DemoTurnContextInput {
  route: string;
  selection: string;
}

export interface DemoContextStageState {
  buildCount: number;
  cacheScope: 'session' | 'turn';
  cacheStatus?: SegmentTokenRecord['cacheStatus'];
  id: string;
  modelPosition: string;
  phase: PipelinePhase;
  replayed: boolean;
  sourceType: SegmentTokenRecord['sourceType'];
  tokens: number;
  value?: string;
}

export interface DemoModelOption {
  cacheReadPerMillion: number;
  contextWindow: number;
  id: string;
  inputPerMillion: number;
  name: string;
  outputPerMillion: number;
  reasoning: boolean;
}

export interface DemoMessageView {
  id: string;
  role: 'assistant' | 'tool' | 'user';
  stopReason?: string;
  text: string;
}

export interface DemoSessionState {
  cacheIdentity: string;
  contextStages: DemoContextStageState[];
  generation: number;
  instanceId: string;
  messages: DemoMessageView[];
  modelId: string;
  sessionId: string;
  strict: boolean;
  summary?: SessionTokenSummary;
}

export interface DemoMutationResult {
  accepted: boolean;
  event?: PrefixMutationEvent;
  state: DemoSessionState;
}

export type DemoStreamEvent =
  | { state: DemoSessionState; type: 'turn-start' }
  | {
      contextStages: DemoContextStageState[];
      snapshot: TurnTokenSnapshot;
      summary?: SessionTokenSummary;
      type: 'token-snapshot';
    }
  | { delta: string; type: 'text-delta' }
  | {
      cacheReadTokens: number;
      cacheReadCost: number;
      cacheWriteTokens: number;
      cacheWriteCost: number;
      inputCost: number;
      inputTokens: number;
      modelId: string;
      outputCost: number;
      outputTokens: number;
      reasoningTokens?: number;
      totalCost: number;
      turnId: string;
      type: 'provider-usage';
    }
  | { message: DemoMessageView; type: 'assistant-final' }
  | { event: PrefixMutationEvent; type: 'prefix-mutation' }
  | { message: string; type: 'trace' }
  | { message: string; type: 'error' }
  | { state: DemoSessionState; type: 'done' };

export type DemoSourceRecord = Pick<
  SegmentTokenRecord,
  'accuracy' | 'cacheStatus' | 'characters' | 'moduleId' | 'percentage' | 'sourceType' | 'tokens'
>;
