import {
  Play,
  Pause,
  Rows3,
  GanttChart,
  BarChart3,
  Search,
  Command,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Circle,
  AlertCircle,
  MessageCircle,
  Upload,
  FilePlus,
  Pencil,
  Brain,
  Terminal,
  FileText,
  MessageSquare,
  CornerDownLeft,
  ArrowUpDown,
  SlidersHorizontal,
  Minus,
  Download,
  Workflow,
  Clock,
  ArrowRight,
  Send,
  Sparkles,
  SunMedium,
  Moon,
  Monitor,
  Check,
} from "lucide-react";

var ICON_MAP = {
  play: Play,
  pause: Pause,
  tracks: Rows3,
  waterfall: GanttChart,
  stats: BarChart3,
  search: Search,
  command: Command,
  close: X,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevron-down": ChevronDown,
  circle: Circle,
  "alert-circle": AlertCircle,
  "message-circle": MessageCircle,
  upload: Upload,
  "file-plus": FilePlus,
  pencil: Pencil,
  reasoning: Brain,
  tool_call: Terminal,
  context: FileText,
  output: MessageSquare,
  enter: CornerDownLeft,
  "arrow-up-down": ArrowUpDown,
  filter: SlidersHorizontal,
  minus: Minus,
  download: Download,
  graph: Workflow,
  clock: Clock,
  "arrow-right": ArrowRight,
  send: Send,
  sparkles: Sparkles,
  sun: SunMedium,
  moon: Moon,
  monitor: Monitor,
  check: Check,
};

export default function Icon({ name, size, strokeWidth, style, className }) {
  var Component = ICON_MAP[name];
  if (!Component) {
    if (process.env.NODE_ENV !== "production") console.warn("Icon: unknown name \"" + name + "\"");
    return null;
  }
  return (
    <Component
      size={size || 14}
      strokeWidth={strokeWidth || 1.5}
      style={style}
      className={className}
    />
  );
}
