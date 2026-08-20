import { PipelineConfigurationError } from './errors.js';
import type {
  AttributedContent,
  Awaitable,
  ContributionSlot,
  MessagePipelineContext,
  MessageProcessor,
  PipelinePhase,
} from './types.js';
import type { TokenCacheScope, TokenSourceType } from './token-types.js';

export interface ContextProviderOptions {
  cacheScope?: 'session' | 'turn';
  contentCacheScope?: TokenCacheScope;
  pin?: boolean;
  sourceType?: TokenSourceType;
}

export abstract class BaseContextProvider<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> implements MessageProcessor<Message, Initial, Step, Services, Metadata> {
  abstract readonly id: string;
  abstract readonly phase: PipelinePhase;
  abstract readonly slot: ContributionSlot;

  readonly access = { reads: ['content'] as const, writes: 'none' as const };
  readonly cacheScope: 'session' | 'turn';
  readonly pin: boolean;
  protected readonly contentCacheScope: TokenCacheScope;
  protected readonly sourceType: TokenSourceType;

  constructor(options: ContextProviderOptions = {}) {
    this.cacheScope = options.cacheScope ?? 'turn';
    this.contentCacheScope = options.contentCacheScope ?? this.cacheScope;
    this.pin = options.pin ?? false;
    this.sourceType = options.sourceType ?? 'runtime-state';
  }

  async process(
    context: MessagePipelineContext<Message, Initial, Step, Services, Metadata>,
  ): Promise<void> {
    const built = await this.build(context);
    if (!built) return;

    const content: Omit<AttributedContent, 'moduleId' | 'processorId'> =
      typeof built === 'string'
        ? {
            cacheScope: this.contentCacheScope,
            id: `${this.id}:content`,
            sourceType: this.sourceType,
            text: built,
          }
        : built;
    if (!content.text.trim()) return;
    if (this.pin) {
      context.contribute({ content, pin: true, slot: this.slot });
      return;
    }
    context.contribute({ content, slot: this.slot });
  }

  protected abstract build(
    context: MessagePipelineContext<Message, Initial, Step, Services, Metadata>,
  ): Awaitable<Omit<AttributedContent, 'moduleId' | 'processorId'> | null | string>;
}

export abstract class BaseSystemPromptProvider<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> extends BaseContextProvider<Message, Initial, Step, Services, Metadata> {
  readonly phase = 'system' as const;
  readonly slot = 'system' as const;

  constructor(options: ContextProviderOptions = {}) {
    super({
      cacheScope: 'session',
      contentCacheScope: 'session',
      sourceType: 'system',
      ...options,
    });
  }
}

export abstract class BaseFirstUserContentProvider<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> extends BaseContextProvider<Message, Initial, Step, Services, Metadata> {
  readonly phase = 'stable-context' as const;
  readonly slot = 'stable-prefix' as const;

  constructor(options: ContextProviderOptions = {}) {
    super({ cacheScope: 'session', contentCacheScope: 'session', ...options });
  }
}

export abstract class BaseLastUserContentProvider<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> extends BaseContextProvider<Message, Initial, Step, Services, Metadata> {
  readonly phase = 'user-augmentation' as const;
  readonly slot = 'last-user' as const;

  constructor(options: ContextProviderOptions = {}) {
    const cacheScope = options.pin ? (options.cacheScope ?? 'session') : options.cacheScope;
    if (options.pin && cacheScope === 'turn') {
      throw new PipelineConfigurationError('pin: true requires cacheScope "session"');
    }
    if (options.pin) {
      super({
        ...options,
        cacheScope: cacheScope ?? 'session',
        contentCacheScope: options.contentCacheScope ?? 'session',
      });
      return;
    }
    super(options);
  }
}

export abstract class BaseVirtualTailProvider<
  Message = unknown,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> extends BaseContextProvider<Message, Initial, Step, Services, Metadata> {
  readonly phase = 'virtual-tail' as const;
  readonly slot = 'virtual-tail' as const;
}
