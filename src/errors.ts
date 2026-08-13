import type { PrefixMutationEvent } from './types.js';

export class PrefixMutationError extends Error {
  constructor(readonly event: PrefixMutationEvent) {
    super(
      `Session ${event.sessionId} attempted to modify committed message prefix at index ${event.firstChangedIndex}`,
    );
    this.name = 'PrefixMutationError';
  }
}

export class EngineDestroyedError extends Error {
  constructor(sessionId: string) {
    super(`Session message engine ${sessionId} has been destroyed`);
    this.name = 'EngineDestroyedError';
  }
}

export class ConcurrentCompilationError extends Error {
  constructor(sessionId: string) {
    super(`Session message engine ${sessionId} is already compiling a turn`);
    this.name = 'ConcurrentCompilationError';
  }
}

export class PipelineConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineConfigurationError';
  }
}

export class PipelineProcessorError extends Error {
  constructor(
    readonly processorId: string,
    cause: unknown,
  ) {
    super(`Message processor ${processorId} failed`, {
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    });
    this.name = 'PipelineProcessorError';
  }
}
