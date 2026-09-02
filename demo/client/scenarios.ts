export interface ExperimentScenario {
  badge: string;
  description: string;
  id: string;
  prompt: string;
  tag: string;
  title: string;
}

export const EXPERIMENT_SCENARIOS: ExperimentScenario[] = [
  {
    badge: 'SCENARIO 01',
    description:
      'Validate that appending new turns without modifying past message history enables 100% KV prefix reuse on supported providers.',
    id: 'append-only',
    prompt:
      'Explain why an append-only transcript improves provider prompt caching in three points.',
    tag: 'Cache Stability',
    title: 'Deterministic Prefix Reuse',
  },
  {
    badge: 'SCENARIO 02',
    description:
      'Inject session-scoped workspace metadata and turn parameters at deterministic pipeline offsets without invalidating upstream system tokens.',
    id: 'context-pinning',
    prompt: 'Remember that the experiment codename is Green Ribbon. Confirm it briefly.',
    tag: 'Context Injection',
    title: 'Stable Context Anchoring',
  },
  {
    badge: 'SCENARIO 03',
    description:
      'Retrieve committed history facts from earlier turns to confirm that prefix caching delivers identical token representations with zero accuracy loss.',
    id: 'prefix-verification',
    prompt: 'What was the experiment codename, and which earlier message established it?',
    tag: 'Integrity Check',
    title: 'Committed Prefix Recall',
  },
  {
    badge: 'SCENARIO 04',
    description:
      'Each user message carries a pinned request_context with route, selection, and sent_at. It lands once and never moves, so it survives tool loops without rewriting the cached prefix.',
    id: 'pinned-user',
    prompt:
      'List the sent_at timestamp and route attached to each of my messages so far, in order. Reply with those values only.',
    tag: 'Pinned User',
    title: 'Per-Turn Pinned Timestamp',
  },
  {
    badge: 'SCENARIO 05',
    description:
      'Call a tool with a large payload. Within a generation the result stays byte-stable; after a prefix invalidation older results collapse to a stub.',
    id: 'tool-result-rewrite',
    prompt: 'Call market_snapshot for MU.US and summarize the 30-day trend in two sentences.',
    tag: 'History Rewrite',
    title: 'Tool Result Collapse',
  },
];
