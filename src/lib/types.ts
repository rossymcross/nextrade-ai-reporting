export type ChartType = "line" | "bar" | "pie";
export type ValueFormat = "currency" | "count" | "percent";

export interface ChartSpec {
  type: ChartType;
  title: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, string | number>>;
  valueFormat: ValueFormat;
}

export interface Highlight {
  label: string;
  value: string; // preformatted
  sub?: string;
}

export interface AssistantReply {
  text: string;
  chart?: ChartSpec;
  highlights?: Highlight[];
  unsupported?: { reason: string; suggestions: string[] };
  debug?: {
    intent: unknown;
    rangeLabel?: string;
    rowCount?: number;
    supplierId: string;
  };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  reply?: AssistantReply;
  id: string;
}
