# Pinned last-user sections and tool-result rewrite seam

Date: 2026-08-20
Status: approved for spec
Implementation note (2026-09-02): shipped as a dedicated `pinned-user` slot / `BasePinnedUserProvider` instead of a `pin: true` flag on `last-user`; the rewrite callback also receives `ordinal` and `total`; the tool-result pin table is engine-internal, not on the processor context.
Scope: `@innei/message-engine` library only. No host-product integration in this change.

## Motivation

The library already has two contribution lifetimes:

- `cacheScope: 'session'` — `build()` runs once and the text is reused. `last-user` apply still re-resolves `index.lastUser` every compile, so the same text jumps onto a new user message and is stripped from the old one. The compiled prefix breaks.
- `cacheScope: 'turn'` — recomputed every compile. `virtual-tail` never enters the prefix. `last-user` can rewrite a user message that was already part of the previous compiled prefix, especially inside a tool loop.

A third need is a **constant section**: inject once for the engine instance, leave it where it landed, and let later tool calls be the changelog (same shape as editing a file). The host should not have to decide whether the underlying data changed. The library must not rewrite committed compiled prefix in order to refresh that section.

Separately, after a rebuild or prefix invalidation, provider cache is already gone. Historical `role: tool` / `toolResult` bodies are often huge and no longer important. The library should allow rewriting those bodies without deleting the tool-call structure. How to rewrite is host policy and is not specified here.

## Decisions

- Pin is **opt-in** (`pin: true`). Existing `session` / `turn` / four slots stay as they are if `pin` is omitted.
- A pinned last-user section is **one copy per engine instance**. It binds to the first successful target and never rebinds or rebuilds.
- Pin apply is compile-time only. `rawMessages` / `getMessages()` stay host transcript. Replay uses an engine-owned pin table.
- `pin: true` requires `cacheScope: 'session'`. `pin` + `turn` is a configuration error.
- First landing must not mutate a message that already appeared in a previous compiled prefix. If the current last user is already committed, append a new user message to carry the section.
- Tool-result policy is **not** built in. One optional rewrite callback; the library identifies results, asks once per result per generation, and pins that rewrite.
- `invalidatePrefix()` clears the pin table and the session contribution cache (generation + 1). `destroy()` clears everything. Those are the mid-session and full escapes for a pinned baseline.
- Out of scope: digest observe/promote/freeze, diffs / JSON Patch, sliding truncation inside a live generation, dropping tool-call/result pairs, default stubs or keep-last-N.

## Architecture

```
contribute({ slot: 'last-user', pin: true, content })
        │
        ▼
  Pin table (engine instance)
    processorId + content.id → { text, digest, targetMessageId | appendedMessageId }
        │
        ▼
  compileTurn apply
    replay pinned text onto the bound message (or the appended carrier)
    never re-resolve index.lastUser

history (optional)
  createToolResultRewriteProcessor(rewrite)
        │
        ▼
  for each getToolResultId message, once per generation:
    rewrite(...) → string | Message | undefined
    pin compiled body for this generation
```

Prefix integrity for these paths is a **compiled-output** invariant: given the same generation and the same raw transcript, pinned sections and rewritten tool bodies occupy the same positions with the same text.

## 1. Pinned last-user

### API

```ts
interface ContextContributionInput {
  content: ...
  order?: number
  slot: ContributionSlot
  pin?: boolean
}

interface ContextProviderOptions {
  cacheScope?: 'session' | 'turn'
  contentCacheScope?: TokenCacheScope
  sourceType?: TokenSourceType
  pin?: boolean
}
```

`BaseLastUserContentProvider` forwards `pin` into `contribute`. Pipeline configuration throws if `pin` is set on a slot other than `last-user`, or if `pin: true` with `cacheScope: 'turn'`.

### Apply

On first successful apply for `(processorId, content.id)`:

1. If `index.lastUser` is a message appended after the previous compile (`index >= lastCompiledMessageCount`), append the contribution text to that message and record its message id as the pin target.
2. If there is no last user, skip this compile (no pin recorded). Retry next compile.
3. If last user exists but is already in the previous compiled prefix, do not `appendTextToUserMessage`. `createUserMessage` the section as a new user message at the end of the compiled list. Record that carrier as the pin target.

On later compiles in the same generation: replay the **stored** text onto the **stored** target. Do not call `build()` again (`session` cache). Do not apply to a newer last user.

Session contribution cache still stores the contribution text so `build()` does not rerun. Pin table is additional state: target identity. Apply of `pin: true` contributions must not go through the current “replay then `index.lastUser`” path; rebinding is the bug this change removes. Multiple `pin` contributions in the same first compile may share one uncommitted last user (append in processor order). If landing creates a carrier message, each still-unpinned `pin` contribution that cannot use a committed last user gets its own carrier.

If the target message is gone from the raw transcript, that is a prefix mutation path: existing `syncTranscript` / `invalidatePrefix` handling runs, pin table is cleared, next compile is a first landing again.

### Turn-scoped last-user (unchanged slot, tighter write)

`cacheScope: 'turn'` last-user (no `pin`) may only augment a user message appended since the previous compile. Writing a committed last user throws `PipelineConfigurationError`. Per-turn data that must sit after a tool loop uses `virtual-tail`.

### Token attribution

Pinned content uses `cacheScope: 'session'` once landed. The carrier message, if appended by the engine, is a compile-time user message like `stable-prefix` / `virtual-tail` (not written to raw).

## 2. Tool-result rewrite seam

### Adapter

```ts
interface MessageAdapter<Message> {
  // existing
  getToolResultId?(message: Message): string | undefined;
  // new, required only if rewrite is used
  replaceToolResultText?(message: Message, text: string): Message;
}
```

Identity of a tool result is `getToolResultId`, not a role string. Pi `toolResult` and OpenAI-style `role: 'tool'` both qualify.

### Processor factory

```ts
function createToolResultRewriteProcessor<Message>(
  rewrite: (input: {
    message: Message
    toolCallId: string
    index: number
  }) => Message | string | undefined,
): MessageProcessor<Message, ...>
```

Phase: `history`. Default: not installed.

- `undefined` — leave the message.
- `string` — `replaceToolResultText`; if the adapter lacks that method, configuration error at apply time.
- `Message` — `replaceMessage` at `index`. The replacement must still be a tool result for the same `toolCallId`; otherwise throw.

The engine records `(generation, toolCallId, fingerprint(applied message))`. Later compiles in the same generation do not call `rewrite` again for that id; they replay the stored compiled message. If the callback would have returned something else, it is ignored (no prefix rewrite, no extra hook).

This runs on generation boundaries in practice because a live generation already pinned the first rewrite. A new instance or `invalidatePrefix()` (generation + 1) consults `rewrite` again.

No `onBefore` / `onAfter` hooks. Hosts that need more than the callback write their own `history` processor and `replaceMessage`.

## 3. Escapes

| Intent                                              | Mechanism                                                       |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Do not pin                                          | Omit `pin`. last-user still rebinds to current `index.lastUser` |
| Latest every turn, do not touch old messages        | `virtual-tail`                                                  |
| This turn's new user only                           | `last-user` + `cacheScope: 'turn'`                              |
| Replace the pinned baseline while the session lives | `invalidatePrefix()`                                            |
| End the instance                                    | `destroy()`                                                     |
| No tool-result rewriting                            | Do not install the processor                                    |
| Custom tool-result / history edits                  | Own `history` processor                                         |

`replaceMessage` / `replaceMessages` remain for `history` / `sanitize`. They do not update the pin table. Invalidating a pin still goes through `invalidatePrefix()`.

## Error handling

- `pin` on non-`last-user` slot, or `pin` + `turn`: `PipelineConfigurationError` when the pipeline plan is built or when the contribution is applied (whichever sees the full flags).
- Turn last-user targeting a committed index: `PipelineConfigurationError` during apply.
- `rewrite` returns a message that is not the same tool call: `PipelineProcessorError`.
- `rewrite` returns `string` without `replaceToolResultText`: `PipelineConfigurationError`.
- Prefix mutation of raw transcript: existing strict / non-strict behavior. Pin table and session contribution cache clear on accepted invalidation and on blocked throw after the event is emitted (same as today for session cache on accept; on strict throw, state is unchanged so pins remain with the rejected transcript).

Strict throw must not clear pins (engine state unchanged). Non-strict accept clears pins.

## Testing

- First compile with `pin: true`: section lands on the new last user; raw transcript unchanged.
- Second compile after append user + assistant: section still on the original user; new user has no copy; `build()` not called again.
- Tool loop (no new user): turn last-user throws if it targets the pinned/committed user; pinned session section still replays on the original target.
- First `pin` when last user is already compiled: a new compiled user message is appended; raw unchanged.
- `pin` + `turn` fails fast.
- Omit `pin`: existing last-user rebind behavior (regression).
- `invalidatePrefix` then compile: `build()` runs again; new landing allowed.
- Tool-result processor: callback called once per `toolCallId` per generation; second compile replays even if callback would return different text.
- `string` rewrite uses adapter; missing adapter method fails.
- Replacement `Message` with a different `toolCallId` fails.
- Without the processor, tool result bodies pass through.

## Documentation

README: document `pin` on last-user, the compiled-only replay, `createToolResultRewriteProcessor`, and the escape table. Do not describe host-product document context.

## Non-goals

Host editor agents, digest-based snapshot promotion, diff injection, automatic tool-result stubs, truncating tool calls, compacting already-pinned sections inside a generation.
