import type {
  MessageEngineTraceActivity,
  MessageEngineTraceRun,
} from '../../../src/devtools-recorder.js';
import type { TurnTokenSnapshot } from '../../../src/token-types.js';

export type DevtoolsTab = 'activities' | 'anatomy' | 'overview' | 'raw';

export interface RunsRailProps {
  onSearchChange: (query: string) => void;
  onSelectRun: (sessionId: string) => void;
  runs: MessageEngineTraceRun[];
  searchQuery: string;
  selectedSessionId: string | undefined;
}

export interface CallTimelineProps {
  onSelectTurn: (index: number) => void;
  run: MessageEngineTraceRun;
  selectedTurnIndex: number;
}

export interface DevtoolsInspectorProps {
  activeTab: DevtoolsTab;
  onTabChange: (tab: DevtoolsTab) => void;
  run: MessageEngineTraceRun;
  selectedTurn: TurnTokenSnapshot | undefined;
}
