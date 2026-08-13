import type { SessionTokenSummary } from './token-types.js';

interface ManagedEngine {
  readonly instanceId: string;
  readonly sessionId: string;
  destroy(): Promise<SessionTokenSummary>;
}

export class MessageEngineRegistry<Engine extends ManagedEngine> {
  private readonly engines = new Map<string, Engine>();

  acquire(sessionId: string, create: () => Engine): Engine {
    const existing = this.engines.get(sessionId);
    if (existing) return existing;

    const engine = create();
    if (engine.sessionId !== sessionId) {
      throw new Error(
        `Engine session ${engine.sessionId} does not match registry key ${sessionId}`,
      );
    }
    this.engines.set(sessionId, engine);
    return engine;
  }

  get(sessionId: string): Engine | undefined {
    return this.engines.get(sessionId);
  }

  async destroy(sessionId: string): Promise<SessionTokenSummary | undefined> {
    const engine = this.engines.get(sessionId);
    if (!engine) return undefined;
    this.engines.delete(sessionId);
    return engine.destroy();
  }

  async destroyAll(): Promise<void> {
    const engines = [...this.engines.values()];
    this.engines.clear();
    const results = await Promise.allSettled(engines.map((engine) => engine.destroy()));
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, 'Engine registry teardown failed');
  }

  has(sessionId: string): boolean {
    return this.engines.has(sessionId);
  }

  get size(): number {
    return this.engines.size;
  }
}
