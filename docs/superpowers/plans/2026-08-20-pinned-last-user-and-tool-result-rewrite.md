# Pinned last-user and tool-result rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in `pin: true` last-user sections that bind once per engine instance, plus an optional history processor that rewrites tool-result bodies once per generation.

**Architecture:** Pin state lives on `SessionMessagesEngine` and is applied during `last-user` contribution apply, not by rebinding `index.lastUser`. Tool-result rewriting is a stock `history` processor that consults a host callback once per `toolCallId` per generation and pins the compiled message. Neither path writes `rawMessages`.

**Tech Stack:** TypeScript 5.9, Vitest 4, existing `SessionMessagesEngine` / `PipelineExecutionContext` / `MessageAdapter`.

## Global Constraints

- Library-only change; no mx-core / editor host integration.
- `pin` is opt-in; omitting it preserves current last-user rebind behavior.
- `pin: true` requires `cacheScope: 'session'` and `slot: 'last-user'`.
- Tool-result policy is not built in (no default stub, no keep-last-N).
- Do not add `onBefore` / `onAfter` rewrite hooks.
- Zero comments / JSDoc in business code (user rule).
- After edits, lint/typecheck/format only the files you modified (`pnpm exec prettier --write <files>`, `pnpm exec tsc -p tsconfig.json --noEmit` is whole-project; prefer `pnpm exec vitest run <test-file>` for tests).
- Node.js >= 22. Test command: `pnpm exec vitest run <file>`.

## File structure

- Modify: `src/types.ts` — `pin` on contributions; `generation` and `replaceToolResultText` on pipeline context.
- Modify: `src/message-adapter.ts` — optional `replaceToolResultText`.
- Modify: `src/providers.ts` — `pin` on `ContextProviderOptions` / `BaseLastUserContentProvider`.
- Create: `src/last-user-pin.ts` — pin record types and last-user apply helper (keeps `pipeline.ts` from growing past 500 lines).
- Modify: `src/pipeline.ts` — store `pin`, pass committed count + pin map, split last-user apply.
- Modify: `src/session-engine.ts` — own the pin map; pass it into compile; clear on accepted invalidation / destroy, not on strict throw.
- Create: `src/tool-result-rewrite.ts` — `createToolResultRewriteProcessor`.
- Modify: `src/index.ts` — export the factory and pin types.
- Modify: `src/adapters/pi.ts` — `replaceToolResultText`.
- Create: `test/pinned-last-user.test.ts`
- Create: `test/tool-result-rewrite.test.ts`
- Modify: `test/pi-adapter.test.ts`
- Modify: `README.md`

---

### Task 1: Contribution `pin` flag and provider wiring

**Files:**
- Modify: `src/types.ts`
- Modify: `src/providers.ts`
- Modify: `src/pipeline.ts` (`StoredContribution` already extends `ContextContribution`; `contribute` must copy `pin`)
- Create: `test/pinned-last-user.test.ts`

**Interfaces:**
- Consumes: existing `ContextContributionInput`, `BaseLastUserContentProvider`, `PipelineConfigurationError`
- Produces: `pin?: boolean` on `ContextContribution`, `ContextContributionInput`, and `ContextProviderOptions`; `BaseLastUserContentProvider` sets `readonly pin` and defaults `cacheScope` to `'session'` when `pin` is true

- [ ] **Step 1: Write the failing tests**

Create `test/pinned-last-user.test.ts` with the same `TestMessage` / `createTestAdapter` / `createEngine` / `message` helpers as `test/session-engine.test.ts` (copy them; do not refactor the old file).

```ts
import { describe, expect, it } from 'vitest';

import {
  BaseLastUserContentProvider,
  PipelineConfigurationError,
  SessionMessagesEngine,
  type MessageAdapter,
  type MessagePipelineContext,
} from '../src/index.js';

interface TestMessage {
  content: string;
  role: 'assistant' | 'toolResult' | 'user';
  timestamp: number;
  toolCallId?: string;
}

const createTestAdapter = (): MessageAdapter<TestMessage> => ({
  id: 'test-message/v1',
  appendTextToUserMessage: (message, content) => ({
    ...message,
    content: `${message.content}\n\n${content}`,
  }),
  clone: (message) => ({ ...message }),
  createUserMessage: (content, timestamp = 0) => ({ content, role: 'user', timestamp }),
  fingerprint: (message) => JSON.stringify(message),
  getRole: (message) => message.role,
  getTextSegments: (message) => [
    {
      content: message.content,
      sourceType: message.role === 'toolResult' ? 'tool-result' : message.role,
    },
  ],
  getToolResultId: (message) => message.toolCallId,
});

const message = (content: string, role: TestMessage['role'] = 'user'): TestMessage => ({
  content,
  role,
  timestamp: 1,
});

const createEngine = (
  overrides: Partial<
    ConstructorParameters<
      typeof SessionMessagesEngine<
        TestMessage,
        { agent: string },
        { turn: number },
        Record<string, never>,
        { visited?: boolean }
      >
    >[0]
  > = {},
) =>
  new SessionMessagesEngine<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  >({
    adapter: createTestAdapter(),
    initial: { agent: 'test' },
    services: {},
    sessionId: 'session-1',
    ...overrides,
  });

describe('pinned last-user contributions', () => {
  it('rejects pin with turn cacheScope on the last-user provider', () => {
    expect(
      () =>
        new (class extends BaseLastUserContentProvider<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        > {
          readonly id = 'pinned.section';
          constructor() {
            super({ cacheScope: 'turn', pin: true });
          }
          protected build() {
            return 'section';
          }
        })(),
    ).toThrow(PipelineConfigurationError);
  });

  it('rejects pin contributions on a non-last-user slot', async () => {
    const engine = createEngine({
      modules: [
        {
          id: 'bad',
          processors: [
            {
              id: 'bad.tail',
              phase: 'virtual-tail',
              cacheScope: 'session',
              process(context) {
                context.contribute({
                  pin: true,
                  slot: 'virtual-tail',
                  content: {
                    cacheScope: 'session',
                    id: 'x',
                    sourceType: 'knowledge',
                    text: 'nope',
                  },
                });
              },
            },
          ],
        },
      ],
    });
    engine.append([message('hello')]);
    await expect(engine.compileTurn({ step: { turn: 1 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts`

Expected: FAIL — `pin` does not exist on provider options / contribute input, or constructor does not throw.

- [ ] **Step 3: Types and provider**

In `src/types.ts` add `pin?: boolean` to `ContextContribution` and `ContextContributionInput`.

In `src/providers.ts`:

```ts
export interface ContextProviderOptions {
  cacheScope?: 'session' | 'turn';
  contentCacheScope?: TokenCacheScope;
  pin?: boolean;
  sourceType?: TokenSourceType;
}
```

On `BaseContextProvider` add `readonly pin: boolean` default false from options.

On `BaseLastUserContentProvider` constructor:

```ts
constructor(options: ContextProviderOptions = {}) {
  const cacheScope = options.pin ? (options.cacheScope ?? 'session') : options.cacheScope;
  if (options.pin && cacheScope === 'turn') {
    throw new PipelineConfigurationError('pin: true requires cacheScope "session"');
  }
  super({
    ...options,
    ...(options.pin
      ? { cacheScope: cacheScope ?? 'session', contentCacheScope: options.contentCacheScope ?? 'session' }
      : {}),
  });
  this.pin = options.pin ?? false;
}
```

`BaseContextProvider.process` must pass `pin: this.pin` into `contribute` when true.

Import `PipelineConfigurationError` in `providers.ts`. Avoid nested ternaries (repo lint).

In `src/pipeline.ts` `contribute()`, copy `pin` onto the stored contribution. If `contribution.pin` and `contribution.slot !== 'last-user'`, throw `PipelineConfigurationError` with message `pin: true is only valid for slot "last-user"`.

`contributionsSince` must preserve `pin` (it already spreads the contribution minus `sequence`).

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/providers.ts src/pipeline.ts test/pinned-last-user.test.ts
git commit -m "feat: add opt-in pin flag for last-user contributions"
```

---

### Task 2: Pin bind-once apply and turn last-user committed guard

**Files:**
- Create: `src/last-user-pin.ts`
- Modify: `src/pipeline.ts`
- Modify: `src/session-engine.ts`
- Modify: `src/types.ts` (`MessagePipelineContext` does not need pin map on the public context; keep it on `PipelineExecutionContext`)
- Modify: `test/pinned-last-user.test.ts`

**Interfaces:**
- Consumes: `pin` on contributions from Task 1; `lastCompiledMessageCount` on the engine (already exists, starts at `0`)
- Produces: `LastUserPin` and `lastUserPinKey`; `PipelineExecutionContext` constructed with `committedRawCount` and `lastUserPins: Map<string, LastUserPin>`; engine owns that map

Pin record:

```ts
export type LastUserPin =
  | { kind: 'message'; rawMessageId: string; text: string }
  | { kind: 'carrier'; insertAt: number; text: string };

export const lastUserPinKey = (processorId: string, contentId: string): string =>
  `${processorId}:${contentId}`;
```

- [ ] **Step 1: Write the failing tests**

Add to `test/pinned-last-user.test.ts`:

```ts
it('pins a session last-user section on the first user and does not rebind', async () => {
  let builds = 0;
  class PinnedSection extends BaseLastUserContentProvider<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  > {
    readonly id = 'pinned.section';
    constructor() {
      super({ pin: true, sourceType: 'knowledge' });
    }
    protected build() {
      builds += 1;
      return 'workspace snapshot';
    }
  }

  const engine = createEngine({
    modules: [{ id: 'pinned', processors: [new PinnedSection()] }],
  });
  engine.append([message('ask')]);
  const first = await engine.compileTurn({ step: { turn: 1 } });
  expect(first.messages.map((item) => item.content)).toEqual(['ask\n\nworkspace snapshot']);
  expect(engine.getMessages().map((item) => item.content)).toEqual(['ask']);

  engine.append([message('answer', 'assistant'), message('follow up')]);
  const second = await engine.compileTurn({ step: { turn: 2 } });
  expect(second.messages.map((item) => item.content)).toEqual([
    'ask\n\nworkspace snapshot',
    'answer',
    'follow up',
  ]);
  expect(builds).toBe(1);
  expect(engine.getMessages().map((item) => item.content)).toEqual(['ask', 'answer', 'follow up']);
});

it('still rebinds unpinned last-user contributions to the current last user', async () => {
  class MovingSection extends BaseLastUserContentProvider<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  > {
    readonly id = 'moving.section';
    constructor() {
      super({ cacheScope: 'session', sourceType: 'knowledge' });
    }
    protected build() {
      return 'moving';
    }
  }
  const engine = createEngine({
    modules: [{ id: 'moving', processors: [new MovingSection()] }],
  });
  engine.append([message('ask')]);
  await engine.compileTurn({ step: { turn: 1 } });
  engine.append([message('answer', 'assistant'), message('follow up')]);
  const second = await engine.compileTurn({ step: { turn: 2 } });
  expect(second.messages.map((item) => item.content)).toEqual([
    'ask',
    'answer',
    'follow up\n\nmoving',
  ]);
});

it('rejects turn last-user writes to a committed user message', async () => {
  class TurnAugment extends BaseLastUserContentProvider<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  > {
    readonly id = 'turn.augment';
    protected build() {
      return 'now';
    }
  }
  const engine = createEngine({
    modules: [{ id: 'turn', processors: [new TurnAugment()] }],
  });
  engine.append([message('ask')]);
  await engine.compileTurn({ step: { turn: 1 } });
  engine.append([message('answer', 'assistant')]);
  await expect(engine.compileTurn({ step: { turn: 2 } })).rejects.toBeInstanceOf(
    PipelineConfigurationError,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts`

Expected: FAIL — pinned section rebinds to follow-up user; turn augment still writes the old last user.

- [ ] **Step 3: Implement pin apply**

Create `src/last-user-pin.ts` with `LastUserPin`, `lastUserPinKey`, and a function:

```ts
export const applyLastUserContributions = <Message>(input: {
  adapter: MessageAdapter<Message>
  committedRawCount: number
  contributions: Array<ContextContribution & { sequence: number }>
  lastUserPins: Map<string, LastUserPin>
  messageIds: string[]
  messageList: Message[]
}): { indexDirty: boolean } => { ... }
```

Behavior:

1. Partition contributions into `pin === true` and the rest (stable sort by `order ?? sequence`, then sequence).
2. For each pinned contribution, key = `lastUserPinKey(content.processorId, content.id)`.
3. If the map already has the key, replay:
   - `kind: 'message'`: find `messageIds.indexOf(rawMessageId)` among current messages; `appendTextToUserMessage` at that index. If not found, skip (prefix mutation will clear the table).
   - `kind: 'carrier'`: handled in Task 3; for this task throw nothing — if kind is carrier, splice `createUserMessage(text)` at `insertAt`.
4. If the key is missing (first landing):
   - Let `lastUser` be the last index whose `getRole === 'user'` in `messageList` (caller passes current last user index).
   - If `lastUser === null`, skip (do not record a pin).
   - If `lastUser >= committedRawCount`, append text onto that message and `set(key, { kind: 'message', rawMessageId: messageIds[lastUser], text })`.
   - If `lastUser < committedRawCount`, Task 3 carrier; in this task still implement carrier so the next test can land: `createUserMessage(text)` pushed at `messageList.length`, `set(key, { kind: 'carrier', insertAt: messageList.length - 1 after push, text })`. Wait: insert at end of compiled list which currently equals raw copy, so `insertAt = messageList.length` before push.
5. For unpinned contributions: join texts with `\n\n` as today. If `lastUser === null`, skip. If `lastUser < committedRawCount`, throw `PipelineConfigurationError` (`last-user contributions cannot modify a committed user message`). Else `appendTextToUserMessage`.

Do not join pinned and unpinned texts.

In `PipelineExecutionContext`:

- Add constructor args `committedRawCount: number` and `lastUserPins: Map<string, LastUserPin>` (after `initialIndex` to limit churn, or replace the long arg list only at the `executeCompile` call site).
- `applySlot('last-user')` calls `applyLastUserContributions` instead of the current block.
- `executePipeline`: after `process`, if `processor.cacheScope !== 'session'` and `contributionsSince` contains `pin: true`, throw `PipelineConfigurationError` (`pin: true requires cacheScope "session"`).

In `SessionMessagesEngine`:

- `private readonly lastUserPins = new Map<string, LastUserPin>()`
- Pass `this.lastCompiledMessageCount` and `this.lastUserPins` into `PipelineExecutionContext`
- Do not clear the map yet (Task 4)

`createUserMessage` for carriers: `this.adapter.createUserMessage(content, undefined, { cacheScope: 'session', slot: 'stable-prefix' })` is wrong slot. Carrier is a compile-time user message without a slot on `InjectedUserMessageContext` (only `stable-prefix` | `virtual-tail`). Pass no context, or extend context later; for this task call `createUserMessage(text)` with no third arg. Message id: `injected:last-user-pin:${fingerprint(text)}`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts test/session-engine.test.ts`

Expected: PASS, including existing `replays session-scoped provider contributions without rebuilding them` (unpinned session last-user still rebinds).

- [ ] **Step 5: Commit**

```bash
git add src/last-user-pin.ts src/pipeline.ts src/session-engine.ts src/types.ts test/pinned-last-user.test.ts
git commit -m "feat: bind pinned last-user sections to the first target message"
```

---

### Task 3: Carrier message when first pin would rewrite a committed user

**Files:**
- Modify: `src/last-user-pin.ts` (carrier branch already sketched in Task 2; lock tests)
- Modify: `test/pinned-last-user.test.ts`

**Interfaces:**
- Consumes: `LastUserPin` `{ kind: 'carrier'; insertAt: number; text: string }`
- Produces: same; replay inserts at stored `insertAt` in increasing `insertAt` order before applying `kind: 'message'` pins

- [ ] **Step 1: Write the failing test**

```ts
it('appends a compile-time carrier when the first pin would rewrite a committed user', async () => {
  class LatePin extends BaseLastUserContentProvider<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  > {
    readonly id = 'late.pin';
    constructor() {
      super({ pin: true, sourceType: 'knowledge' });
    }
    protected build() {
      return 'late section';
    }
  }

  const engine = createEngine();
  engine.append([message('ask')]);
  await engine.compileTurn({ step: { turn: 1 } });

  engine.append([message('answer', 'assistant')]);
  const withPin = new SessionMessagesEngine<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  >({
    adapter: createTestAdapter(),
    initial: { agent: 'test' },
    modules: [{ id: 'late', processors: [new LatePin()] }],
    services: {},
    sessionId: 'session-carrier',
  });
  withPin.append([message('ask'), message('answer', 'assistant')]);
  const compiled = await withPin.compileTurn({ step: { turn: 2 } });
  expect(compiled.messages.map((item) => item.content)).toEqual([
    'ask',
    'answer',
    'late section',
  ]);
  expect(withPin.getMessages().map((item) => item.content)).toEqual(['ask', 'answer']);

  withPin.append([message('next')]);
  const second = await withPin.compileTurn({ step: { turn: 3 } });
  expect(second.messages.map((item) => item.content)).toEqual([
    'ask',
    'answer',
    'late section',
    'next',
  ]);
});
```

This test uses a **new engine** whose first compile already has a committed-looking last user: `lastCompiledMessageCount` is 0 on a fresh engine, so the first compile would bake into `ask` (index 0 >= 0), not create a carrier.

That is wrong for the spec’s “already compiled prefix” case **on the same engine**. Fix the test: same engine, add the pin module from construction, but first compile happens **without** the processor enabled, then enable it? Modules are fixed at construction.

Correct setup: engine constructed **with** the pin processor, but `enabled()` returns false until turn 2.

```ts
class LatePin extends BaseLastUserContentProvider<...> {
  readonly id = 'late.pin';
  constructor() {
    super({ pin: true, sourceType: 'knowledge' });
  }
  enabled(context: MessagePipelineContext<...>) {
    return context.step.turn >= 2;
  }
  protected build() {
    return 'late section';
  }
}

const engine = createEngine({
  modules: [{ id: 'late', processors: [new LatePin()] }],
});
engine.append([message('ask')]);
await engine.compileTurn({ step: { turn: 1 } });
engine.append([message('answer', 'assistant')]);
const compiled = await engine.compileTurn({ step: { turn: 2 } });
```

Turn 1: processor disabled, lastCompiledMessageCount becomes 1. Turn 2: last user is still `ask` at index 0 < 1, so carrier at end after `answer`. Then append `next`, turn 3: carrier still at insertAt 2 (raw length at first landing was 2: ask, answer). Raw after append is [ask, answer, next]. Replay splice at 2: [ask, answer, late section, next].

Use this `enabled` pattern in the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts`

Expected: FAIL if carrier replay inserts at the new end (`next` then section) or bakes into `ask`.

- [ ] **Step 3: Implement carrier replay**

In `applyLastUserContributions`:

- First landing with `lastUser < committedRawCount`: `insertAt = messageList.length`, push `createUserMessage(text)`, push message id `injected:last-user-pin:${fingerprint(text)}`, record `{ kind: 'carrier', insertAt, text }`, `indexDirty = true`.
- Replay: apply all `kind: 'carrier'` pins sorted by `insertAt` ascending, splicing the created user message and id at `insertAt` on the list **starting from the raw copy**. Then apply `kind: 'message'` pins.

If two pins carrier-land in one compile, second `insertAt` is `messageList.length` after the first push so they get 2, 3, … Replay in increasing insertAt.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts test/session-engine.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/last-user-pin.ts test/pinned-last-user.test.ts
git commit -m "feat: append a pinned last-user carrier when the last user is committed"
```

---

### Task 4: Clear pins on accepted invalidation and destroy

**Files:**
- Modify: `src/session-engine.ts` (`handlePrefixMutation`, `executeDestroy`)
- Modify: `test/pinned-last-user.test.ts`

**Interfaces:**
- Consumes: `lastUserPins` from Task 2
- Produces: `lastUserPins.clear()` next to `sessionContributionCache.clear()` in non-strict `handlePrefixMutation` and `executeDestroy` only

- [ ] **Step 1: Write the failing tests**

```ts
it('rebuilds a pin after invalidatePrefix', async () => {
  let builds = 0;
  class PinnedSection extends BaseLastUserContentProvider<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  > {
    readonly id = 'pinned.section';
    constructor() {
      super({ pin: true, sourceType: 'knowledge' });
    }
    protected build() {
      builds += 1;
      return `snapshot-${builds}`;
    }
  }
  const engine = createEngine({
    modules: [{ id: 'pinned', processors: [new PinnedSection()] }],
  });
  engine.append([message('ask')]);
  await engine.compileTurn({ step: { turn: 1 } });
  await engine.invalidatePrefix({ reason: 'pipeline-changed', expected: true });
  engine.append([message('answer', 'assistant'), message('again')]);
  const after = await engine.compileTurn({ step: { turn: 2 } });
  expect(builds).toBe(2);
  expect(after.messages.at(-1)?.content).toBe('again\n\nsnapshot-2');
});

it('does not clear pins when strict mode blocks a transcript mutation', async () => {
  class PinnedSection extends BaseLastUserContentProvider<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  > {
    readonly id = 'pinned.section';
    constructor() {
      super({ pin: true, sourceType: 'knowledge' });
    }
    protected build() {
      return 'workspace snapshot';
    }
  }
  const engine = createEngine({
    modules: [{ id: 'pinned', processors: [new PinnedSection()] }],
    strict: true,
  });
  engine.append([message('ask')]);
  await engine.compileTurn({ step: { turn: 1 } });
  await expect(engine.syncTranscript([message('mutated')])).rejects.toBeInstanceOf(
    PrefixMutationError,
  );
  engine.append([message('answer', 'assistant')]);
  const after = await engine.compileTurn({ step: { turn: 2 } });
  expect(after.messages[0]?.content).toBe('ask\n\nworkspace snapshot');
});
```

Import `PrefixMutationError`.

After `invalidatePrefix`, `lastCompiledMessageCount` is already reset to `0` in `handlePrefixMutation`, so the new last user `again` is treated as uncommitted and receives the new snapshot. That matches “first landing again”.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts`

Expected: FAIL — `builds` stays 1 after invalidate because session cache still replays old contribution / pin table still bound to first user.

- [ ] **Step 3: Clear the pin map**

In `handlePrefixMutation`, after `this.sessionContributionCache.clear()`, add `this.lastUserPins.clear()`. This runs only when not throwing (strict throw happens before generation increment and cache clear — keep that order). Confirm current code: it increments and clears **after** `if (this.strict) throw`. Do not move the throw.

In `executeDestroy`, clear `lastUserPins` next to the other arrays.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run test/pinned-last-user.test.ts test/session-engine.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session-engine.ts test/pinned-last-user.test.ts
git commit -m "fix: clear last-user pins on prefix invalidation and destroy"
```

---

### Task 5: Tool-result rewrite processor

**Files:**
- Modify: `src/message-adapter.ts` — `replaceToolResultText?(message: Message, text: string): Message`
- Modify: `src/types.ts` — `generation: number` on `MessagePipelineContext`; `replaceToolResultText(index: number, text: string): void`
- Modify: `src/pipeline.ts` — implement those on `PipelineExecutionContext`
- Create: `src/tool-result-rewrite.ts`
- Modify: `src/index.ts` — `export * from './tool-result-rewrite.js'`
- Modify: `src/session-engine.ts` — pass `generation: this.generationValue` into context
- Create: `test/tool-result-rewrite.test.ts`

**Interfaces:**
- Consumes: `MessageAdapter.getToolResultId`; new `replaceToolResultText`
- Produces:

```ts
export interface ToolResultRewriteInput<Message> {
  index: number
  message: Message
  toolCallId: string
}

export type ToolResultRewrite<Message> = (
  input: ToolResultRewriteInput<Message>,
) => Message | string | undefined

export const createToolResultRewriteProcessor = <
  Message,
  Initial = unknown,
  Step = unknown,
  Services = Record<string, never>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
>(
  rewrite: ToolResultRewrite<Message>,
): MessageProcessor<Message, Initial, Step, Services, Metadata>
```

Processor: `id: 'history.rewrite-tool-results'`, `phase: 'history'`, `access: { reads: ['content', 'ids'], writes: 'content' }`.

- [ ] **Step 1: Write the failing tests**

Copy the test helpers from Task 1 into `test/tool-result-rewrite.test.ts`, and add `replaceToolResultText` on the adapter:

```ts
replaceToolResultText: (message, text) => {
  if (message.role !== 'toolResult') return message;
  return { ...message, content: text };
},
```

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  PipelineConfigurationError,
  PipelineProcessorError,
  createToolResultRewriteProcessor,
  SessionMessagesEngine,
  type MessageAdapter,
} from '../src/index.js';

// helpers omitted here — copy TestMessage, message(), createEngine from pinned-last-user tests,
// but put replaceToolResultText on the adapter as above.

const toolResult = (toolCallId: string, content: string): TestMessage => ({
  content,
  role: 'toolResult',
  timestamp: 1,
  toolCallId,
});

describe('tool result rewrite', () => {
  it('asks the host once per toolCallId per generation and pins the body', async () => {
    const rewrite = vi.fn((input: { toolCallId: string; message: TestMessage }) => {
      if (input.toolCallId === 'call-1') return 'truncated';
      return undefined;
    });
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(rewrite)],
        },
      ],
    });
    engine.append([
      message('ask'),
      message('call', 'assistant'),
      toolResult('call-1', 'huge payload'),
    ]);
    const first = await engine.compileTurn({ step: { turn: 1 } });
    expect(first.messages[2]?.content).toBe('truncated');
    expect(engine.getMessages()[2]?.content).toBe('huge payload');

    rewrite.mockImplementation(() => 'should-not-apply');
    engine.append([message('more', 'assistant')]);
    const second = await engine.compileTurn({ step: { turn: 2 } });
    expect(second.messages[2]?.content).toBe('truncated');
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('consults rewrite again after invalidatePrefix', async () => {
    const rewrite = vi.fn(() => 'v1');
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(rewrite)],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    await engine.compileTurn({ step: { turn: 1 } });
    rewrite.mockImplementation(() => 'v2');
    await engine.invalidatePrefix({ expected: true, reason: 'pipeline-changed' });
    const after = await engine.compileTurn({ step: { turn: 2 } });
    expect(after.messages[1]?.content).toBe('v2');
    expect(rewrite).toHaveBeenCalledTimes(2);
  });

  it('rejects a replacement message with a different toolCallId', async () => {
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [
            createToolResultRewriteProcessor<TestMessage>(() =>
              toolResult('other', 'nope'),
            ),
          ],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    await expect(engine.compileTurn({ step: { turn: 1 } })).rejects.toBeInstanceOf(
      PipelineProcessorError,
    );
  });

  it('fails when a string rewrite is returned without replaceToolResultText', async () => {
    const adapter = createTestAdapter();
    delete (adapter as { replaceToolResultText?: unknown }).replaceToolResultText;
    const engine = createEngine({
      adapter,
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(() => 'x')],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    await expect(engine.compileTurn({ step: { turn: 1 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });
});
```

`createTestAdapter` in this file should include `replaceToolResultText` by default. The last test clones/deletes the method.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/tool-result-rewrite.test.ts`

Expected: FAIL — `createToolResultRewriteProcessor` is not exported.

- [ ] **Step 3: Implement**

`MessageAdapter.replaceToolResultText?`

`MessagePipelineContext`:

```ts
readonly generation: number
replaceToolResultText(index: number, text: string): void
```

`PipelineExecutionContext` stores `generation`, implements `replaceToolResultText` by calling adapter method or throwing `PipelineConfigurationError('replaceToolResultText is not implemented by adapter …')`.

Constructor: add `generation` argument; `executeCompile` passes `this.generationValue`.

`src/tool-result-rewrite.ts`:

```ts
export const createToolResultRewriteProcessor = <Message, Initial, Step, Services, Metadata extends Record<string, unknown>>(
  rewrite: ToolResultRewrite<Message>,
): MessageProcessor<Message, Initial, Step, Services, Metadata> => {
  const pinned = new Map<string, Message>()
  let pinnedGeneration: number | undefined
  return {
    id: 'history.rewrite-tool-results',
    phase: 'history',
    access: { reads: ['content', 'ids'], writes: 'content' },
    process(context) {
      if (pinnedGeneration !== context.generation) {
        pinned.clear()
        pinnedGeneration = context.generation
      }
      const adapterGetId = /* cannot access adapter */
```

The processor cannot call `getToolResultId` unless it is on context. Add to `MessagePipelineContext`:

```ts
getToolResultId(message: Message): string | undefined
```

implemented as `this.adapter.getToolResultId?.(message)`.

Processor loop: for `index, message of context.messages`:

```
const toolCallId = context.getToolResultId(message)
if (!toolCallId) continue
const existing = pinned.get(toolCallId)
if (existing) {
  context.replaceMessage(index, existing)
  continue
}
const result = rewrite({ index, message, toolCallId })
if (result === undefined) continue
if (typeof result === 'string') {
  context.replaceToolResultText(index, result)
} else {
  const nextId = context.getToolResultId(result)
  if (nextId !== toolCallId) throw new Error(`tool result rewrite changed toolCallId ${toolCallId}`)
  context.replaceMessage(index, result)
}
pinned.set(toolCallId, context.messages[index]!)
```

Throwing inside `process` becomes `PipelineProcessorError` in `executePipeline`. Good.

`getToolResultId` on context is a small addition; put it next to `replaceToolResultText`.

Export from `src/index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run test/tool-result-rewrite.test.ts test/session-engine.test.ts test/pinned-last-user.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message-adapter.ts src/types.ts src/pipeline.ts src/session-engine.ts src/tool-result-rewrite.ts src/index.ts test/tool-result-rewrite.test.ts
git commit -m "feat: add once-per-generation tool result rewrite processor"
```

---

### Task 6: Pi adapter `replaceToolResultText`

**Files:**
- Modify: `src/adapters/pi.ts`
- Modify: `test/pi-adapter.test.ts`

**Interfaces:**
- Consumes: `MessageAdapter.replaceToolResultText` from Task 5
- Produces: `piMessageAdapter.replaceToolResultText`

- [ ] **Step 1: Write the failing test**

In `test/pi-adapter.test.ts`:

```ts
it('replaces Pi toolResult text for host rewrites', () => {
  const original = {
    content: 'huge tool output',
    role: 'toolResult',
    toolCallId: 'call-1',
    timestamp: 1,
  } as AgentMessage;
  const replaced = piMessageAdapter.replaceToolResultText?.(original, 'truncated');
  expect(replaced).toEqual({ ...original, content: 'truncated' });
  expect(piMessageAdapter.getToolResultId?.(replaced!)).toBe('call-1');
});
```

If Pi toolResult content is an array of parts in this version, assert by replacing the first text part. Inspect a real `toolResult` from `@earendil-works/pi-ai` if the object shape differs; keep `role` and `toolCallId` unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/pi-adapter.test.ts`

Expected: FAIL — method undefined.

- [ ] **Step 3: Implement**

On `piMessageAdapter`:

```ts
replaceToolResultText(message, text) {
  if (!isRecord(message) || message.role !== 'toolResult') return message;
  if (typeof message.content === 'string') {
    return { ...message, content: text } as AgentMessage;
  }
  if (Array.isArray(message.content)) {
    const parts = [...message.content];
    const textIndex = parts.findIndex(
      (part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string',
    );
    if (textIndex === -1) {
      return { ...message, content: [{ text, type: 'text' }] } as AgentMessage;
    }
    const current = parts[textIndex];
    if (!isRecord(current)) return message;
    parts[textIndex] = { ...current, text };
    return { ...message, content: parts } as AgentMessage;
  }
  return { ...message, content: text } as AgentMessage;
},
```

No nested ternaries.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run test/pi-adapter.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/pi.ts test/pi-adapter.test.ts
git commit -m "feat: replace Pi toolResult text through the message adapter"
```

---

### Task 7: README

**Files:**
- Modify: `README.md` (Pipeline model + Prefix integrity sections)

**Interfaces:**
- Consumes: public API from Tasks 1–6
- Produces: documentation only

- [ ] **Step 1: Write README additions**

After the `BaseLastUserContentProvider` paragraph, add:

Pinned last-user (opt-in): `super({ pin: true })` or `contribute({ slot: 'last-user', pin: true, content })`. The section binds to the first successful target for the engine instance and is replayed there on later compiles. It is not written to `getMessages()`. If that first target is already in the previous compiled prefix, the engine appends a compile-time user message instead of rewriting the committed user. `pin` requires `cacheScope: 'session'`. Omit `pin` to keep current last-user rebinding.

Turn-scoped last-user may only augment a user message appended since the previous compile; otherwise `PipelineConfigurationError`. Use `virtual-tail` for per-turn data after a tool loop.

Tool results: `createToolResultRewriteProcessor(rewrite)` in phase `history`. `rewrite` may return `undefined`, a replacement string (`adapter.replaceToolResultText`), or a message with the same `toolCallId`. Each `toolCallId` is rewritten at most once per generation; `invalidatePrefix()` starts a new generation. Not installed by default.

Escape table (markdown table): omit `pin`; `virtual-tail`; turn last-user; `invalidatePrefix()`; `destroy()`; do not install the rewrite processor; custom `history` processor + `replaceMessage`.

- [ ] **Step 2: Format the touched markdown if prettier includes it**

Run: `pnpm exec prettier --write README.md`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document pinned last-user sections and tool result rewrites"
```

---

## Self-review

**Spec coverage**

| Spec item | Task |
| --- | --- |
| `pin?: boolean` opt-in on contribute / last-user provider | 1 |
| `pin` + `turn` configuration error | 1 |
| `pin` on non-last-user slot error | 1 |
| Bind to first target; no rebind; `build()` once | 2 |
| Unpinned last-user still rebinds | 2 |
| Turn last-user cannot write committed user | 2 |
| Compile-only; raw / `getMessages()` clean | 2 |
| Carrier when last user already compiled | 3 |
| `invalidatePrefix` / destroy clear pins; strict throw does not | 4 |
| `rewriteToolResult` once per generation; string / Message / undefined | 5 |
| Same `toolCallId` required; missing adapter method errors | 5 |
| Pi `replaceToolResultText` | 6 |
| README + escape table | 7 |
| No diffs, no default stubs, no extra hooks | honored (not in plan) |

**Placeholders:** none.

**Type names:** `LastUserPin`, `lastUserPinKey`, `createToolResultRewriteProcessor`, `ToolResultRewrite`, `ToolResultRewriteInput`, `pin`, `replaceToolResultText`, `getToolResultId` on context — used consistently.
