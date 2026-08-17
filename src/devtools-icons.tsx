import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Command,
  Database,
  Download,
  Info,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  MessageSquareText,
  Radio,
  RotateCw,
  Scan,
  Search,
  Timer,
  TriangleAlert,
  Wrench,
} from 'lucide-react';

import type {
  MessageEngineTraceActivityKind,
  MessageEngineTraceRunStatus,
} from './devtools-recorder.js';

const ICON_STROKE = 1.75;

const STATUS_ICONS = {
  error: CircleX,
  running: LoaderCircle,
  success: CircleCheck,
} as const;

const ACTIVITY_ICONS = {
  error: CircleAlert,
  info: Info,
  'rate-limit': Timer,
  retry: RotateCw,
  tool: Wrench,
} as const;

const INSPECTOR_VIEW_ICONS = {
  activities: Activity,
  cache: Database,
  overview: LayoutDashboard,
  prompt: MessageSquareText,
  raw: Braces,
} as const;

const MeIcon = ({ icon: Icon, size = 12 }: { icon: LucideIcon; size?: number | undefined }) => (
  <Icon aria-hidden="true" className="me-icon" size={size} strokeWidth={ICON_STROKE} />
);

export const ProductIcon = () => <MeIcon icon={Layers} />;
export const SearchIcon = () => <MeIcon icon={Search} size={14} />;
export const EmptyIcon = () => <MeIcon icon={Scan} size={18} />;
export const ExportIcon = () => <MeIcon icon={Download} />;
export const ConnectionIcon = () => <MeIcon icon={Radio} />;
export const PrefixAlertIcon = () => <MeIcon icon={TriangleAlert} />;
export const InspectIcon = () => <MeIcon icon={ArrowRight} />;
export const InjectedIcon = () => <MeIcon icon={Info} size={8} />;
export const BreadcrumbIcon = () => (
  <span className="me-breadcrumb">
    <MeIcon icon={ChevronRight} />
  </span>
);
export const ShortcutIcon = () => <MeIcon icon={Command} size={10} />;
export const ArrowIcon = () => <MeIcon icon={ArrowRight} />;

export const StatusIcon = ({ status }: { status: MessageEngineTraceRunStatus }) => (
  <MeIcon icon={STATUS_ICONS[status]} />
);

export const ActivityKindIcon = ({ kind }: { kind: MessageEngineTraceActivityKind }) => (
  <MeIcon icon={ACTIVITY_ICONS[kind]} />
);

export const InspectorViewIcon = ({ view }: { view: keyof typeof INSPECTOR_VIEW_ICONS }) => (
  <MeIcon icon={INSPECTOR_VIEW_ICONS[view]} />
);
