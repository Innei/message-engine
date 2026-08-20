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

const isCommittedRawId = (
  messageId: string | undefined,
  committedRawIds: ReadonlySet<string>,
): boolean => messageId !== undefined && committedRawIds.has(messageId);

const resolveHostLastUserIndex = (
  hostLastUserId: string | undefined,
  messageIds: readonly string[],
): number | null => {
  if (hostLastUserId === undefined) return null;
  const index = messageIds.indexOf(hostLastUserId);
  if (index === -1) return null;
  return index;
};

const landPinnedContribution = <Message>(input: {
  adapter: MessageAdapter<Message>;
  committedRawIds: ReadonlySet<string>;
  hostLastUserId: string | undefined;
  key: string;
  lastUserPins: Map<string, LastUserPin>;
  messageIds: string[];
  messageList: Message[];
  text: string;
}): boolean => {
  const {
    adapter,
    committedRawIds,
    hostLastUserId,
    key,
    lastUserPins,
    messageIds,
    messageList,
    text,
  } = input;
  const lastUser = resolveHostLastUserIndex(hostLastUserId, messageIds);
  if (lastUser === null) return false;

  if (!isCommittedRawId(hostLastUserId, committedRawIds)) {
    const message = messageList[lastUser];
    if (message === undefined || hostLastUserId === undefined) return false;
    messageList[lastUser] = adapter.appendTextToUserMessage(message, text);
    lastUserPins.set(key, { kind: 'message', rawMessageId: hostLastUserId, text });
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
  committedRawIds: ReadonlySet<string>;
  contributions: Array<ContextContribution & { sequence: number }>;
  lastUserPins: Map<string, LastUserPin>;
  messageIds: string[];
  messageList: Message[];
}): { indexDirty: boolean } => {
  const { adapter, committedRawIds, lastUserPins, messageIds, messageList } = input;
  const ordered = [...input.contributions].sort(byContributionOrder);
  const pinned = ordered.filter((entry) => entry.pin === true);
  const unpinned = ordered.filter((entry) => entry.pin !== true);
  const lastUser = findLastUserIndex(adapter, messageList);
  const hostLastUserId = lastUser === null ? undefined : messageIds[lastUser];
  let indexDirty = false;

  if (unpinned.length > 0 && isCommittedRawId(hostLastUserId, committedRawIds)) {
    const writesCommittedTurn = unpinned.some((entry) => entry.content.cacheScope !== 'session');
    if (writesCommittedTurn) {
      throw new PipelineConfigurationError(
        'last-user contributions cannot modify a committed user message',
      );
    }
  }

  const pendingLand: SequencedContribution[] = [];
  const carrierPins: Array<Extract<LastUserPin, { kind: 'carrier' }>> = [];
  const messagePins: Array<Extract<LastUserPin, { kind: 'message' }>> = [];

  for (const contribution of pinned) {
    const key = lastUserPinKey(contribution.content.processorId, contribution.content.id);
    const existing = lastUserPins.get(key);
    if (existing === undefined) {
      pendingLand.push(contribution);
      continue;
    }
    if (existing.kind === 'carrier') {
      carrierPins.push(existing);
      continue;
    }
    messagePins.push(existing);
  }

  carrierPins.sort((left, right) => left.insertAt - right.insertAt);
  for (const pin of carrierPins) {
    if (replayPin(adapter, pin, messageIds, messageList)) indexDirty = true;
  }
  for (const pin of messagePins) {
    replayPin(adapter, pin, messageIds, messageList);
  }
  for (const contribution of pendingLand) {
    const key = lastUserPinKey(contribution.content.processorId, contribution.content.id);
    if (
      landPinnedContribution({
        adapter,
        committedRawIds,
        hostLastUserId,
        key,
        lastUserPins,
        messageIds,
        messageList,
        text: contribution.content.text,
      })
    ) {
      indexDirty = true;
    }
  }

  if (unpinned.length === 0) return { indexDirty };

  const hostLastUser = resolveHostLastUserIndex(hostLastUserId, messageIds);
  if (hostLastUser === null) return { indexDirty };

  const content = unpinned.map((entry) => entry.content.text).join('\n\n');
  const message = messageList[hostLastUser];
  if (message !== undefined) {
    messageList[hostLastUser] = adapter.appendTextToUserMessage(message, content);
  }
  return { indexDirty };
};
