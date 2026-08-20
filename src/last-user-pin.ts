import { PipelineConfigurationError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import type { MessageAdapter } from './message-adapter.js';
import type { ContextContribution } from './types.js';

export type LastUserPin =
  | { kind: 'message'; rawMessageId: string; text: string }
  | { kind: 'carrier'; insertAt: number; text: string };

export const lastUserPinKey = (processorId: string, contentId: string): string =>
  `${processorId}:${contentId}`;

type SequencedContribution = ContextContribution & { sequence: number };

const byContributionOrder = (left: SequencedContribution, right: SequencedContribution): number =>
  (left.order ?? left.sequence) - (right.order ?? right.sequence) || left.sequence - right.sequence;

const carrierMessageId = (text: string): string => `injected:last-user-pin:${fingerprint(text)}`;

const findLastUserIndex = <Message>(
  adapter: MessageAdapter<Message>,
  messageList: readonly Message[],
): number | null => {
  for (let index = messageList.length - 1; index >= 0; index -= 1) {
    const message = messageList[index];
    if (message !== undefined && adapter.getRole(message) === 'user') return index;
  }
  return null;
};

const replayPin = <Message>(
  adapter: MessageAdapter<Message>,
  pin: LastUserPin,
  messageIds: string[],
  messageList: Message[],
): boolean => {
  if (pin.kind === 'message') {
    const index = messageIds.indexOf(pin.rawMessageId);
    if (index === -1) return false;
    const message = messageList[index];
    if (message === undefined) return false;
    messageList[index] = adapter.appendTextToUserMessage(message, pin.text);
    return false;
  }

  messageList.splice(pin.insertAt, 0, adapter.createUserMessage(pin.text));
  messageIds.splice(pin.insertAt, 0, carrierMessageId(pin.text));
  return true;
};

const landPinnedContribution = <Message>(input: {
  adapter: MessageAdapter<Message>;
  committedRawCount: number;
  key: string;
  lastUser: number | null;
  lastUserPins: Map<string, LastUserPin>;
  messageIds: string[];
  messageList: Message[];
  text: string;
}): boolean => {
  const { adapter, committedRawCount, key, lastUser, lastUserPins, messageIds, messageList, text } =
    input;
  if (lastUser === null) return false;

  if (lastUser >= committedRawCount) {
    const message = messageList[lastUser];
    const rawMessageId = messageIds[lastUser];
    if (message === undefined || rawMessageId === undefined) return false;
    messageList[lastUser] = adapter.appendTextToUserMessage(message, text);
    lastUserPins.set(key, { kind: 'message', rawMessageId, text });
    return false;
  }

  const insertAt = messageList.length;
  messageList.push(adapter.createUserMessage(text));
  messageIds.push(carrierMessageId(text));
  lastUserPins.set(key, { kind: 'carrier', insertAt, text });
  return true;
};

export const applyLastUserContributions = <Message>(input: {
  adapter: MessageAdapter<Message>;
  committedRawCount: number;
  contributions: Array<ContextContribution & { sequence: number }>;
  lastUserPins: Map<string, LastUserPin>;
  messageIds: string[];
  messageList: Message[];
}): { indexDirty: boolean } => {
  const { adapter, committedRawCount, lastUserPins, messageIds, messageList } = input;
  const ordered = [...input.contributions].sort(byContributionOrder);
  const pinned = ordered.filter((entry) => entry.pin === true);
  const unpinned = ordered.filter((entry) => entry.pin !== true);
  const lastUser = findLastUserIndex(adapter, messageList);
  let indexDirty = false;

  for (const contribution of pinned) {
    const key = lastUserPinKey(contribution.content.processorId, contribution.content.id);
    const existing = lastUserPins.get(key);
    if (existing) {
      if (replayPin(adapter, existing, messageIds, messageList)) indexDirty = true;
      continue;
    }
    if (
      landPinnedContribution({
        adapter,
        committedRawCount,
        key,
        lastUser,
        lastUserPins,
        messageIds,
        messageList,
        text: contribution.content.text,
      })
    ) {
      indexDirty = true;
    }
  }

  if (unpinned.length === 0 || lastUser === null) return { indexDirty };

  if (lastUser < committedRawCount) {
    const writesCommittedTurn = unpinned.some((entry) => entry.content.cacheScope !== 'session');
    if (writesCommittedTurn) {
      throw new PipelineConfigurationError(
        'last-user contributions cannot modify a committed user message',
      );
    }
  }

  const content = unpinned.map((entry) => entry.content.text).join('\n\n');
  const message = messageList[lastUser];
  if (message !== undefined) {
    messageList[lastUser] = adapter.appendTextToUserMessage(message, content);
  }
  return { indexDirty };
};
