import type { MessageAdapter } from './message-adapter.js';
import type { MessageIndexSnapshot } from './types.js';

export class MessageIndex<Message> {
  private readonly byId = new Map<string, number>();
  private readonly byRole = new Map<string, number[]>();
  private readonly toolCallById = new Map<string, { messageIndex: number; toolName: string }>();
  private readonly toolResultByCallId = new Map<string, number>();
  private firstUser: number | null = null;
  private lastAssistant: number | null = null;
  private lastUser: number | null = null;

  constructor(private readonly adapter: MessageAdapter<Message>) {}

  append(message: Message, messageId: string, index: number): void {
    const role = this.adapter.getRole(message);
    const roleIndexes = this.byRole.get(role) ?? [];
    roleIndexes.push(index);
    this.byRole.set(role, roleIndexes);
    this.byId.set(messageId, index);

    if (role === 'user') {
      if (this.firstUser === null) this.firstUser = index;
      this.lastUser = index;
    } else if (role === 'assistant') {
      this.lastAssistant = index;
    }

    for (const call of this.adapter.getToolCalls?.(message) ?? []) {
      this.toolCallById.set(call.id, { messageIndex: index, toolName: call.name });
    }

    const toolResultId = this.adapter.getToolResultId?.(message);
    if (toolResultId) this.toolResultByCallId.set(toolResultId, index);
  }

  rebuild(messages: readonly Message[], messageIds: readonly string[]): void {
    this.clear();
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const messageId = messageIds[index];
      if (message !== undefined && messageId) this.append(message, messageId, index);
    }
  }

  clear(): void {
    this.byId.clear();
    this.byRole.clear();
    this.toolCallById.clear();
    this.toolResultByCallId.clear();
    this.firstUser = null;
    this.lastAssistant = null;
    this.lastUser = null;
  }

  snapshot(): MessageIndexSnapshot {
    return {
      byId: this.byId,
      byRole: this.byRole,
      firstUser: this.firstUser,
      lastAssistant: this.lastAssistant,
      lastUser: this.lastUser,
      toolCallById: this.toolCallById,
      toolResultByCallId: this.toolResultByCallId,
    };
  }
}
