import { PipelineConfigurationError, PipelineProcessorError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import { applyLastUserContributions, type LastUserPin } from './last-user-pin.js';
import type { MessageAdapter } from './message-adapter.js';
import { MessageIndex } from './message-index.js';
import type {
  ContextContribution,
  ContextContributionInput,
  MessageEngineModule,
  MessageIndexSnapshot,
  MessagePipelineContext,
  MessageProcessor,
  PipelinePhase,
  ProcessorStats,
} from './types.js';
import { PIPELINE_PHASES } from './types.js';

interface PlannedProcessor<
  Message,
  Initial,
  Step,
  Services,
  Metadata extends Record<string, unknown>,
> {
  moduleId: string;
  processor: MessageProcessor<Message, Initial, Step, Services, Metadata>;
  registrationIndex: number;
}

interface StoredContribution extends ContextContribution {
  processorCacheScope: 'session' | 'turn';
  sequence: number;
}

const phaseIndex = new Map<PipelinePhase, number>(
  PIPELINE_PHASES.map((phase, index) => [phase, index]),
);

const contributionSlotsByPhase: Partial<
  Record<PipelinePhase, readonly ContextContribution['slot'][]>
> = {
  'stable-context': ['stable-prefix'],
  'user-augmentation': ['last-user'],
  'virtual-tail': ['virtual-tail'],
  system: ['system'],
};

const sortPhaseProcessors = <
  Message,
  Initial,
  Step,
  Services,
  Metadata extends Record<string, unknown>,
>(
  entries: Array<PlannedProcessor<Message, Initial, Step, Services, Metadata>>,
  allById: ReadonlyMap<string, PlannedProcessor<Message, Initial, Step, Services, Metadata>>,
): Array<PlannedProcessor<Message, Initial, Step, Services, Metadata>> => {
  const entryById = new Map(entries.map((entry) => [entry.processor.id, entry]));
  const incoming = new Map(entries.map((entry) => [entry.processor.id, 0]));
  const outgoing = new Map(entries.map((entry) => [entry.processor.id, new Set<string>()]));

  const addEdge = (from: string, to: string): void => {
    const targets = outgoing.get(from);
    if (!targets || targets.has(to)) return;
    targets.add(to);
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  };

  for (const entry of entries) {
    for (const targetId of entry.processor.before ?? []) {
      const target = allById.get(targetId);
      if (!target) throw new PipelineConfigurationError(`Unknown processor ${targetId}`);
      const currentPhase = phaseIndex.get(entry.processor.phase) ?? 0;
      const targetPhase = phaseIndex.get(target.processor.phase) ?? 0;
      if (targetPhase < currentPhase) {
        throw new PipelineConfigurationError(
          `${entry.processor.id} cannot run before earlier-phase processor ${targetId}`,
        );
      }
      if (targetPhase === currentPhase) addEdge(entry.processor.id, targetId);
    }

    for (const targetId of entry.processor.after ?? []) {
      const target = allById.get(targetId);
      if (!target) throw new PipelineConfigurationError(`Unknown processor ${targetId}`);
      const currentPhase = phaseIndex.get(entry.processor.phase) ?? 0;
      const targetPhase = phaseIndex.get(target.processor.phase) ?? 0;
      if (targetPhase > currentPhase) {
        throw new PipelineConfigurationError(
          `${entry.processor.id} cannot run after later-phase processor ${targetId}`,
        );
      }
      if (targetPhase === currentPhase) addEdge(targetId, entry.processor.id);
    }
  }

  const ready = entries
    .filter((entry) => incoming.get(entry.processor.id) === 0)
    .sort((left, right) => left.registrationIndex - right.registrationIndex);
  const sorted: Array<PlannedProcessor<Message, Initial, Step, Services, Metadata>> = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) break;
    sorted.push(next);
    for (const targetId of outgoing.get(next.processor.id) ?? []) {
      const count = (incoming.get(targetId) ?? 1) - 1;
      incoming.set(targetId, count);
      if (count !== 0) continue;
      const target = entryById.get(targetId);
      if (!target) continue;
      ready.push(target);
      ready.sort((left, right) => left.registrationIndex - right.registrationIndex);
    }
  }

  if (sorted.length !== entries.length) {
    const unresolved = entries
      .filter((entry) => !sorted.includes(entry))
      .map((entry) => entry.processor.id);
    throw new PipelineConfigurationError(
      `Processor ordering contains a cycle: ${unresolved.join(', ')}`,
    );
  }

  return sorted;
};

export class PipelinePlan<
  Message,
  Initial,
  Step,
  Services,
  Metadata extends Record<string, unknown>,
> {
  readonly pipelineHash: string;
  readonly modules: ReadonlyArray<MessageEngineModule<Message, Initial, Step, Services, Metadata>>;
  readonly processors: Array<PlannedProcessor<Message, Initial, Step, Services, Metadata>>;

  constructor(
    modules: ReadonlyArray<MessageEngineModule<Message, Initial, Step, Services, Metadata>>,
  ) {
    this.modules = [...modules];
    const entries: Array<PlannedProcessor<Message, Initial, Step, Services, Metadata>> = [];
    const moduleIds = new Set<string>();
    const processorIds = new Set<string>();

    for (const module of this.modules) {
      if (moduleIds.has(module.id)) {
        throw new PipelineConfigurationError(`Duplicate module id ${module.id}`);
      }
      moduleIds.add(module.id);

      for (const processor of module.processors) {
        if (processorIds.has(processor.id)) {
          throw new PipelineConfigurationError(`Duplicate processor id ${processor.id}`);
        }
        processorIds.add(processor.id);
        entries.push({ moduleId: module.id, processor, registrationIndex: entries.length });
      }
    }

    const allById = new Map(entries.map((entry) => [entry.processor.id, entry]));
    this.processors = PIPELINE_PHASES.flatMap((phase) =>
      sortPhaseProcessors(
        entries.filter((entry) => entry.processor.phase === phase),
        allById,
      ),
    );
    this.pipelineHash = fingerprint(
      this.processors.map(({ moduleId, processor }) => ({
        after: processor.after,
        before: processor.before,
        cacheScope: processor.cacheScope,
        id: processor.id,
        moduleId,
        phase: processor.phase,
      })),
    );
  }
}

export class PipelineExecutionContext<
  Message,
  Initial,
  Step,
  Services,
  Metadata extends Record<string, unknown>,
> implements MessagePipelineContext<Message, Initial, Step, Services, Metadata> {
  private readonly contributionList: StoredContribution[] = [];
  private readonly appliedContributionList: ContextContribution[] = [];
  private readonly messageIndex: MessageIndex<Message>;
  private readonly committedRawIds: ReadonlySet<string>;
  private readonly initialIndex: MessageIndexSnapshot | undefined;
  private abortMessage?: string;
  private activeModuleId = 'engine';
  private activeProcessorCacheScope: 'session' | 'turn' | undefined;
  private activeProcessorId = 'engine';
  private contributionSequence = 0;
  private indexDirty = false;
  private messageList: Message[];
  private messageIds: string[];
  private mutationRevision = 0;
  private prompt: string;
  private usingInitialIndex: boolean;

  readonly metadata: Metadata;

  constructor(
    private readonly adapter: MessageAdapter<Message>,
    readonly rawMessages: readonly Message[],
    rawMessageIds: readonly string[],
    readonly initial: Initial,
    readonly step: Step,
    readonly services: Services,
    metadata: Metadata,
    systemPrompt: string,
    readonly signal: AbortSignal | undefined,
    initialIndex?: MessageIndexSnapshot,
    committedRawCount = 0,
    private readonly lastUserPins: Map<string, LastUserPin> = new Map(),
    readonly generation = 0,
    readonly toolResultPins: Map<string, Message> = new Map(),
  ) {
    this.messageList = [...rawMessages];
    this.messageIds = [...rawMessageIds];
    this.metadata = metadata;
    this.prompt = systemPrompt;
    this.messageIndex = new MessageIndex(adapter);
    this.initialIndex = initialIndex;
    this.usingInitialIndex = initialIndex !== undefined;
    this.committedRawIds = new Set(rawMessageIds.slice(0, committedRawCount));
    if (!initialIndex) this.messageIndex.rebuild(this.messageList, this.messageIds);
  }

  get aborted(): boolean {
    return this.abortMessage !== undefined || this.signal?.aborted === true;
  }

  get abortReason(): string | undefined {
    return this.abortMessage ?? (this.signal?.aborted ? 'aborted' : undefined);
  }

  get index(): MessageIndexSnapshot {
    if (!this.indexDirty && this.usingInitialIndex && this.initialIndex) {
      return this.initialIndex;
    }
    this.ensureIndex();
    return this.messageIndex.snapshot();
  }

  get messages(): readonly Message[] {
    return this.messageList;
  }

  get systemPrompt(): string {
    return this.prompt;
  }

  abort(reason: string): void {
    this.abortMessage = reason;
  }

  appendMessages(messages: readonly Message[]): void {
    if (messages.length === 0) return;
    this.materializeIndex();
    for (const message of messages) {
      const index = this.messageList.length;
      const messageId = `pipeline:${index}:${this.adapter.fingerprint(message)}`;
      this.messageList.push(message);
      this.messageIds.push(messageId);
      if (!this.indexDirty) this.messageIndex.append(message, messageId, index);
    }
    this.mutationRevision += 1;
  }

  contribute(contribution: ContextContributionInput): void {
    if (contribution.pin && contribution.slot !== 'last-user') {
      throw new PipelineConfigurationError('pin: true is only valid for slot "last-user"');
    }
    this.contributionList.push({
      ...contribution,
      content: {
        ...contribution.content,
        moduleId: contribution.content.moduleId ?? this.activeModuleId,
        processorId: contribution.content.processorId ?? this.activeProcessorId,
      },
      processorCacheScope: this.activeProcessorCacheScope ?? 'turn',
      sequence: this.contributionSequence,
    });
    this.contributionSequence += 1;
  }

  getToolResultId(message: Message): string | undefined {
    return this.adapter.getToolResultId?.(message);
  }

  replaceMessage(index: number, message: Message): void {
    if (index < 0 || index >= this.messageList.length) {
      throw new RangeError(`Message index ${index} is out of bounds`);
    }
    this.messageList[index] = message;
    this.messageIds[index] = `pipeline:${index}:${this.adapter.fingerprint(message)}`;
    this.indexDirty = true;
    this.mutationRevision += 1;
  }

  replaceMessages(messages: readonly Message[]): void {
    this.messageList = [...messages];
    this.messageIds = messages.map(
      (message, index) => `pipeline:${index}:${this.adapter.fingerprint(message)}`,
    );
    this.indexDirty = true;
    this.mutationRevision += 1;
  }

  replaceToolResultText(index: number, text: string): void {
    const replace = this.adapter.replaceToolResultText;
    if (!replace) {
      throw new PipelineConfigurationError('replaceToolResultText is not implemented by adapter');
    }
    const current = this.messageList[index];
    if (index < 0 || index >= this.messageList.length || current === undefined) {
      throw new RangeError(`Message index ${index} is out of bounds`);
    }
    this.replaceMessage(index, replace(current, text));
  }

  setMetadata<Key extends keyof Metadata>(key: Key, value: Metadata[Key]): void {
    this.metadata[key] = value;
  }

  setSystemPrompt(systemPrompt: string): void {
    this.prompt = systemPrompt;
    this.mutationRevision += 1;
  }

  activate(moduleId: string, processorId: string, cacheScope?: 'session' | 'turn'): void {
    this.activeModuleId = moduleId;
    this.activeProcessorCacheScope = cacheScope;
    this.activeProcessorId = processorId;
  }

  applyContributionsForPhase(phase: PipelinePhase): void {
    const slots = contributionSlotsByPhase[phase];
    if (!slots) return;

    for (const slot of slots) this.applySlot(slot);
  }

  applyRemainingContributions(): void {
    for (const slot of ['system', 'stable-prefix', 'last-user', 'virtual-tail'] as const) {
      this.applySlot(slot);
    }
  }

  contributionCount(): number {
    return this.contributionList.length;
  }

  contributionsSince(index: number): ContextContribution[] {
    return this.contributionList
      .slice(index)
      .map(({ sequence: _, ...contribution }) => contribution);
  }

  appliedContributions(): readonly ContextContribution[] {
    return this.appliedContributionList;
  }

  currentMutationRevision(): number {
    return this.mutationRevision;
  }

  replayContributions(contributions: readonly ContextContribution[]): void {
    for (const contribution of contributions) this.contribute(contribution);
  }

  snapshotMessages(): Message[] {
    return [...this.messageList];
  }

  private applySlot(slot: ContextContribution['slot']): void {
    const selected = this.contributionList
      .filter((entry) => entry.slot === slot)
      .sort(
        (left, right) =>
          (left.order ?? left.sequence) - (right.order ?? right.sequence) ||
          left.sequence - right.sequence,
      );
    if (selected.length === 0) return;

    this.appliedContributionList.push(
      ...selected.map(({ sequence: _, ...contribution }) => contribution),
    );

    const content = selected.map((entry) => entry.content.text).join('\n\n');
    const cacheScope = selected.every((entry) => entry.content.cacheScope === 'session')
      ? 'session'
      : 'turn';
    if (slot === 'system') {
      this.prompt = [this.prompt, content].filter(Boolean).join('\n\n');
    } else if (slot === 'stable-prefix') {
      const firstUser = this.index.firstUser;
      if (firstUser !== null) {
        const timestamp = Number(
          (this.messageList[firstUser] as unknown as { timestamp?: number }).timestamp ??
            Date.now(),
        );
        this.messageList.splice(
          firstUser,
          0,
          this.adapter.createUserMessage(content, timestamp, { cacheScope, slot }),
        );
        this.messageIds.splice(firstUser, 0, `injected:stable-prefix:${fingerprint(content)}`);
        this.indexDirty = true;
      }
    } else if (slot === 'last-user') {
      const result = applyLastUserContributions({
        adapter: this.adapter,
        committedRawIds: this.committedRawIds,
        contributions: selected,
        lastUserPins: this.lastUserPins,
        messageIds: this.messageIds,
        messageList: this.messageList,
      });
      if (result.indexDirty) this.indexDirty = true;
    } else {
      this.messageList.push(
        this.adapter.createUserMessage(content, undefined, { cacheScope, slot: 'virtual-tail' }),
      );
      this.messageIds.push(`injected:virtual-tail:${fingerprint(content)}`);
      this.indexDirty = true;
    }

    for (let index = this.contributionList.length - 1; index >= 0; index -= 1) {
      if (this.contributionList[index]?.slot === slot) this.contributionList.splice(index, 1);
    }
    this.mutationRevision += 1;
  }

  private ensureIndex(): void {
    if (!this.indexDirty) return;
    this.messageIndex.rebuild(this.messageList, this.messageIds);
    this.indexDirty = false;
    this.usingInitialIndex = false;
  }

  private materializeIndex(): void {
    if (!this.usingInitialIndex || this.indexDirty) return;
    this.messageIndex.rebuild(this.messageList, this.messageIds);
    this.usingInitialIndex = false;
  }
}

export interface ExecutePipelineOptions<
  Message,
  Initial,
  Step,
  Services,
  Metadata extends Record<string, unknown>,
> {
  context: PipelineExecutionContext<Message, Initial, Step, Services, Metadata>;
  plan: PipelinePlan<Message, Initial, Step, Services, Metadata>;
  sessionContributionCache: Map<string, ContextContribution[]>;
}

export const executePipeline = async <
  Message,
  Initial,
  Step,
  Services,
  Metadata extends Record<string, unknown>,
>({
  context,
  plan,
  sessionContributionCache,
}: ExecutePipelineOptions<Message, Initial, Step, Services, Metadata>): Promise<
  ProcessorStats[]
> => {
  const stats: ProcessorStats[] = [];
  let previousPhase: PipelinePhase | undefined;

  for (const entry of plan.processors) {
    const { moduleId, processor } = entry;
    if (previousPhase && previousPhase !== processor.phase) {
      context.applyContributionsForPhase(previousPhase);
    }
    previousPhase = processor.phase;
    if (context.aborted) break;

    context.activate(moduleId, processor.id, processor.cacheScope);
    const startedAt = performance.now();
    const cached =
      processor.cacheScope === 'session' ? sessionContributionCache.get(processor.id) : undefined;

    if (cached) {
      context.replayContributions(cached);
      stats.push({
        durationMs: performance.now() - startedAt,
        id: processor.id,
        phase: processor.phase,
        replayedFromCache: true,
      });
      continue;
    }

    if (processor.enabled && !processor.enabled(context)) continue;
    const contributionStart = context.contributionCount();
    const mutationStart = context.currentMutationRevision();
    try {
      await processor.process(context);
    } catch (error) {
      if (error instanceof PipelineConfigurationError) throw error;
      throw new PipelineProcessorError(processor.id, error);
    }

    const produced = context.contributionsSince(contributionStart);
    if (processor.cacheScope !== 'session' && produced.some((item) => item.pin === true)) {
      throw new PipelineConfigurationError('pin: true requires cacheScope "session"');
    }

    if (processor.cacheScope === 'session') {
      if (context.currentMutationRevision() !== mutationStart) {
        throw new PipelineConfigurationError(
          `Session-cached processor ${processor.id} must only emit contributions`,
        );
      }
      sessionContributionCache.set(processor.id, produced);
    }

    stats.push({
      durationMs: performance.now() - startedAt,
      id: processor.id,
      phase: processor.phase,
      replayedFromCache: false,
    });
  }

  if (previousPhase) context.applyContributionsForPhase(previousPhase);
  context.applyRemainingContributions();
  return stats;
};
