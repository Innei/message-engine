import { PipelineConfigurationError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import type { MessageAdapter } from './message-adapter.js';
import type { StoredContribution } from './pipeline.js';

export type LastUserPin =
  | { kind: 'message'; rawMessageId: string; text: string }
  | { kind: 'carrier'; insertAt: number; text: string };

export const lastUserPinKey = (processorId: string, contentId: string): string =>
  `${processorId}:${contentId}`;

const pinKey = (contribution: StoredContribution, hostLastUserId: string): string => {
  const base = lastUserPinKey(contribution.content.processorId, contribution.content.id);
  return contribution.processorCacheScope === 'session' ? base : `${base}@${hostLastUserId}`;
};

const carrierMessageId = (text: string): string => `injected:pinned-user:${fingerprint(text)}`;

const appendTo = <Message>(
  adapter: MessageAdapter<Message>,
  messageList: Message[],
  index: number,
  text: string,
): void => {
  const message = messageList[index];
  if (message !== undefined) messageList[index] = adapter.appendTextToUserMessage(message, text);
};

interface ApplyInput<Message> {
  adapter: MessageAdapter<Message>;
  committedRawIds: ReadonlySet<string>;
  contributions: readonly StoredContribution[];
  hostLastUserId: string | undefined;
  messageIds: string[];
  messageList: Message[];
}

export const applyPinnedUserContributions = <Message>(
  input: ApplyInput<Message> & { lastUserPins: Map<string, LastUserPin> },
): { indexDirty: boolean } => {
  const { adapter, committedRawIds, hostLastUserId, lastUserPins, messageIds, messageList } = input;
  const initialLength = messageList.length;

  const carriers: Array<Extract<LastUserPin, { kind: 'carrier' }>> = [];
  for (const pin of lastUserPins.values()) {
    if (pin.kind === 'carrier') carriers.push(pin);
    else appendTo(adapter, messageList, messageIds.indexOf(pin.rawMessageId), pin.text);
  }
  carriers.sort((left, right) => left.insertAt - right.insertAt);
  for (const pin of carriers) {
    messageList.splice(pin.insertAt, 0, adapter.createUserMessage(pin.text));
    messageIds.splice(pin.insertAt, 0, carrierMessageId(pin.text));
  }

  const hostLastUser = hostLastUserId === undefined ? -1 : messageIds.lastIndexOf(hostLastUserId);
  if (hostLastUserId !== undefined && hostLastUser !== -1) {
    const committed = committedRawIds.has(hostLastUserId);
    for (const contribution of input.contributions) {
      const key = pinKey(contribution, hostLastUserId);
      if (lastUserPins.has(key)) continue;
      const { text } = contribution.content;
      if (committed) {
        lastUserPins.set(key, { insertAt: messageList.length, kind: 'carrier', text });
        messageList.push(adapter.createUserMessage(text));
        messageIds.push(carrierMessageId(text));
      } else {
        appendTo(adapter, messageList, hostLastUser, text);
        lastUserPins.set(key, { kind: 'message', rawMessageId: hostLastUserId, text });
      }
    }
  }

  return { indexDirty: messageList.length !== initialLength };
};

export const applyLastUserContributions = <Message>(input: ApplyInput<Message>): void => {
  const { adapter, committedRawIds, contributions, hostLastUserId, messageIds, messageList } =
    input;
  if (hostLastUserId === undefined) return;

  if (
    committedRawIds.has(hostLastUserId) &&
    contributions.some((entry) => entry.processorCacheScope === 'turn')
  ) {
    throw new PipelineConfigurationError(
      'turn-scoped last-user contributions cannot modify a committed user message; use slot "virtual-tail" for per-turn data, or slot "pinned-user" for a section that should stay where it first landed',
    );
  }

  const hostLastUser = messageIds.lastIndexOf(hostLastUserId);
  if (hostLastUser === -1) return;
  appendTo(
    adapter,
    messageList,
    hostLastUser,
    contributions.map((entry) => entry.content.text).join('\n\n'),
  );
};
