import type {
  DemoMessageView,
  DemoModelOption,
  DemoSessionContextInput,
  DemoSessionState,
  DemoTurnContextInput,
} from '../shared/protocol.js';

export type ActiveViewMode = 'pipeline' | 'playground' | 'telemetry';

export type InspectorTab = 'anatomy' | 'audit' | 'metrics' | 'stages';

export interface TraceEntry {
  id: number;
  kind: 'error' | 'info' | 'prefix' | 'usage';
  message: string;
  time: string;
}

export type TraceFilter = 'all' | 'error' | 'info' | 'prefix' | 'usage';

export interface LinearDocsSidebarProps {
  activeView: ActiveViewMode;
  apiKey: string;
  environmentKeyAvailable: boolean;
  modelId: string;
  models: DemoModelOption[];
  onApiKeyChange: (key: string) => void;
  onModelChange: (modelId: string) => void;
  onMutatePrefix: () => void;
  onRestartSession: () => void;
  onSelectScenario: (prompt: string) => void;
  onSessionContextChange: (
    updater: (prev: DemoSessionContextInput) => DemoSessionContextInput,
  ) => void;
  onSimulateOrderSwap: () => void;
  onSimulateTimestampDrift: () => void;
  onStrictChange: (strict: boolean) => void;
  onTeardownSession: () => void;
  onTurnContextChange: (updater: (prev: DemoTurnContextInput) => DemoTurnContextInput) => void;
  onViewChange: (view: ActiveViewMode) => void;
  session: DemoSessionState | undefined;
  sessionContext: DemoSessionContextInput;
  streaming: boolean;
  strict: boolean;
  turnContext: DemoTurnContextInput;
}
