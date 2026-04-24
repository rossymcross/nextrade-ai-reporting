import { getAnthropic, MODEL } from "./anthropic";
import {
  metricByDimension,
  trendByDay,
  compareTwoRanges,
  summaryStats,
  type Metric,
  type Dimension,
  type Timeframe,
  metricLabel,
  dimensionLabel,
} from "./queries";
import type { AssistantReply, ChartSpec, Highlight } from "./types";
import type { SupplierId } from "./db";

const SYSTEM_PROMPT = `You are NexTrade AI, an inline reporting assistant for a vendor of a B2B logistics marketplace.

You help a single logged-in vendor understand THEIR OWN sales data. You do not see or receive the vendor's identity — the server enforces that separately. Your sole job is to translate the vendor's plain-English question into one call of the \`generate_report\` tool.

DATA YOU CAN ANSWER FROM
- Products the vendor sells (SKU, name, category, unit price)
- Orders: date, status (delivered/cancelled), total amount
- Order items: quantity, unit price at time of order
- Cancellations: cancelled_at timestamp only. The reason fields exist in the schema but are NEVER populated — the platform does not capture cancellation reasons at checkout.

METRICS YOU CAN COMPUTE
revenue, units_sold, order_count, cancellation_count, cancellation_rate, aov (average order value)

DIMENSIONS YOU CAN GROUP BY
date (trend over time), day_of_week, product, category

TIMEFRAMES
last_n_days (with n), this_month, last_month, this_week, last_week, specific_day (YYYY-MM-DD), date_range (start+end)

WHAT YOU CANNOT ANSWER
- "Why" questions that require reasons for cancellations, returns, customer intent, or fulfillment delays — we simply don't capture that data
- Causal analysis or predictions
- Data about other vendors, the platform overall, or customers' personal information
- Anything outside the schema above

For unanswerable questions, call the tool with intent_type="unsupported" and fill in \`reason\` explaining what data is missing, plus 2-3 concrete suggestions of questions the vendor CAN ask.

WRITING STYLE
- Clear, confident, professional — this is a B2B enterprise product.
- Preface text: 1 short sentence framing the answer. Do NOT invent specific numbers. The data comes back from the server and is rendered in the chart.
- Pick the best chart type:
  - line → trends over time (metric by date)
  - bar → rankings, top-N, comparisons, day-of-week
  - pie → category/breakdown splits with ≤ 7 slices
- Always fill in \`title\` as a short, human-readable chart title.

IMPORTANT: You MUST call the \`generate_report\` tool in every response. Never answer with plain text only.`;

// ---- Tool schema ----

const TOOL = {
  name: "generate_report",
  description:
    "Translate the user's natural-language analytics question into a structured report request that the NexTrade backend will execute and render.",
  input_schema: {
    type: "object" as const,
    properties: {
      intent_type: {
        type: "string",
        enum: [
          "metric_by_dimension",
          "trend",
          "compare",
          "summary",
          "unsupported",
        ],
        description:
          "metric_by_dimension: rank/breakdown (top products, category split, day-of-week). trend: time series. compare: two ranges. summary: overall snapshot. unsupported: question can't be answered with available data.",
      },
      preface: {
        type: "string",
        description:
          "1 short sentence to show above the chart. No specific numbers. Confident and clear.",
      },
      title: {
        type: "string",
        description:
          "Short chart title, e.g. 'Top 5 products by revenue — last month'.",
      },
      chart_type: {
        type: "string",
        enum: ["line", "bar", "pie", "none"],
      },
      metric: {
        type: "string",
        enum: [
          "revenue",
          "units_sold",
          "order_count",
          "cancellation_count",
          "cancellation_rate",
          "aov",
        ],
      },
      dimension: {
        type: "string",
        enum: ["date", "day_of_week", "product", "category"],
      },
      timeframe: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "last_n_days",
              "this_month",
              "last_month",
              "this_week",
              "last_week",
              "specific_day",
              "date_range",
            ],
          },
          n: { type: "number" },
          date: { type: "string", description: "YYYY-MM-DD" },
          start: { type: "string", description: "YYYY-MM-DD" },
          end: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["type"],
      },
      compare: {
        type: "object",
        description: "Only for intent_type='compare'",
        properties: {
          a: { type: "object" },
          b: { type: "object" },
          label_a: { type: "string" },
          label_b: { type: "string" },
        },
      },
      limit: { type: "number", description: "Top/Bottom N" },
      sort: { type: "string", enum: ["asc", "desc"] },
      unsupported: {
        type: "object",
        description: "Only for intent_type='unsupported'",
        properties: {
          reason: { type: "string" },
          suggestions: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 4,
          },
        },
      },
    },
    required: ["intent_type", "preface"],
  },
};

// ---- Value formatting helpers ----

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n > 1000 ? 0 : 2,
  }).format(n);
}

function fmtCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function fmtPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatValue(metric: Metric, v: number): string {
  if (metric === "revenue" || metric === "aov") return fmtCurrency(v);
  if (metric === "cancellation_rate") return fmtPercent(v);
  return fmtCount(v);
}

function metricValueFormat(
  metric: Metric
): "currency" | "count" | "percent" {
  if (metric === "revenue" || metric === "aov") return "currency";
  if (metric === "cancellation_rate") return "percent";
  return "count";
}

// ---- Main entry ----

type RawToolInput = {
  intent_type: string;
  preface?: string;
  title?: string;
  chart_type?: "line" | "bar" | "pie" | "none";
  metric?: Metric;
  dimension?: Dimension;
  timeframe?: Timeframe & Record<string, unknown>;
  compare?: {
    a: Timeframe;
    b: Timeframe;
    label_a: string;
    label_b: string;
  };
  limit?: number;
  sort?: "asc" | "desc";
  unsupported?: { reason: string; suggestions: string[] };
};

export async function runReport(opts: {
  vendorId: SupplierId;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AssistantReply> {
  const today = new Date().toISOString().slice(0, 10);

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `${SYSTEM_PROMPT}\n\nToday is ${today}.`,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "generate_report" },
    messages: [
      ...opts.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: opts.userMessage },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use"
  );

  if (!toolUse) {
    return {
      text:
        "I couldn't translate that into a report. Try asking about revenue, orders, top products, or cancellations over a specific timeframe.",
    };
  }

  const input = toolUse.input as RawToolInput;
  return executeIntent(opts.vendorId, input);
}

function executeIntent(
  vendorId: SupplierId,
  input: RawToolInput
): AssistantReply {
  const preface =
    input.preface?.trim() || "Here's what I found.";

  if (input.intent_type === "unsupported") {
    return {
      text: preface,
      unsupported: {
        reason:
          input.unsupported?.reason ||
          "That question requires data that isn't captured in the platform.",
        suggestions:
          input.unsupported?.suggestions && input.unsupported.suggestions.length
            ? input.unsupported.suggestions
            : [
                "What are my top 5 products by revenue last month?",
                "Show revenue trend for the last 30 days",
                "How does Tuesday compare to Wednesday last week?",
              ],
      },
    };
  }

  try {
    const title = input.title?.trim() || "Report";

    if (input.intent_type === "compare" && input.compare) {
      const metric = input.metric || "revenue";
      const { rows } = compareTwoRanges({
        vendorId,
        metric,
        a: input.compare.a,
        b: input.compare.b,
        labelA: input.compare.label_a,
        labelB: input.compare.label_b,
      });
      const chart: ChartSpec = {
        type: "bar",
        title,
        xKey: "label",
        yKey: "value",
        data: rows,
        valueFormat: metricValueFormat(metric),
      };
      const highlights = buildCompareHighlights(rows, metric);
      return {
        text: preface,
        chart,
        highlights,
        debug: {
          intent: input,
          rowCount: rows.length,
          supplierId: vendorId,
        },
      };
    }

    if (input.intent_type === "trend") {
      const metric = input.metric || "revenue";
      const tf = input.timeframe || { type: "last_n_days", n: 30 };
      const { rows, rangeLabel } = trendByDay({
        vendorId,
        metric,
        timeframe: tf as Timeframe,
      });
      const data = rows.map((r) => ({ label: r.date, value: r.value }));
      const chart: ChartSpec = {
        type: (input.chart_type && input.chart_type !== "none"
          ? input.chart_type
          : "line") as "line" | "bar" | "pie",
        title,
        xKey: "label",
        yKey: "value",
        data,
        valueFormat: metricValueFormat(metric),
      };
      return {
        text: preface,
        chart,
        highlights: buildTrendHighlights(data, metric),
        debug: {
          intent: input,
          rangeLabel,
          rowCount: rows.length,
          supplierId: vendorId,
        },
      };
    }

    if (input.intent_type === "summary") {
      const tf = input.timeframe || { type: "last_n_days", n: 30 };
      const stats = summaryStats(vendorId, tf as Timeframe);
      return {
        text: preface,
        highlights: [
          { label: "Revenue", value: fmtCurrency(stats.totalRevenue), sub: stats.rangeLabel },
          { label: "Orders", value: fmtCount(stats.orderCount), sub: stats.rangeLabel },
          { label: "Units sold", value: fmtCount(stats.unitsSold), sub: stats.rangeLabel },
          { label: "Cancellation rate", value: fmtPercent(stats.cancellationRate), sub: stats.rangeLabel },
          { label: "Avg. order value", value: fmtCurrency(stats.aov), sub: stats.rangeLabel },
          { label: "Active products", value: fmtCount(stats.productCount) },
        ],
        debug: { intent: input, rangeLabel: stats.rangeLabel, supplierId: vendorId },
      };
    }

    // metric_by_dimension (default)
    const metric = input.metric || "revenue";
    const dimension = input.dimension || "product";
    const tf = input.timeframe || { type: "last_n_days", n: 30 };
    const { rows, rangeLabel } = metricByDimension({
      vendorId,
      metric,
      dimension,
      timeframe: tf as Timeframe,
      limit: input.limit,
      sort: input.sort,
    });
    const chartType: "line" | "bar" | "pie" =
      input.chart_type && input.chart_type !== "none"
        ? input.chart_type
        : dimension === "category"
        ? "pie"
        : dimension === "date"
        ? "line"
        : "bar";

    const chart: ChartSpec = {
      type: chartType,
      title,
      xKey: "label",
      yKey: "value",
      data: rows,
      valueFormat: metricValueFormat(metric),
    };

    return {
      text: preface,
      chart,
      highlights: buildDimensionHighlights(rows, metric, dimension),
      debug: {
        intent: input,
        rangeLabel,
        rowCount: rows.length,
        supplierId: vendorId,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text:
        "Something went wrong running that report. Try rephrasing or asking about a different timeframe.",
      debug: { intent: input, supplierId: vendorId, rowCount: 0, rangeLabel: msg },
    };
  }
}

function buildDimensionHighlights(
  rows: Array<{ label: string; value: number }>,
  metric: Metric,
  dimension: Dimension
): Highlight[] {
  if (!rows.length) return [];
  const top = rows[0];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const label = dimensionLabel(dimension).toLowerCase();
  const hs: Highlight[] = [
    { label: `Top ${label}`, value: top.label, sub: formatValue(metric, top.value) },
    { label: metricLabel(metric) + " total", value: formatValue(metric, total) },
  ];
  if (rows.length >= 2) {
    const second = rows[1];
    hs.push({ label: `Runner-up`, value: second.label, sub: formatValue(metric, second.value) });
  }
  return hs;
}

function buildTrendHighlights(
  data: Array<{ label: string; value: number }>,
  metric: Metric
): Highlight[] {
  if (!data.length) return [];
  const total = data.reduce((s, r) => s + r.value, 0);
  const avg = total / data.length;
  const peak = [...data].sort((a, b) => b.value - a.value)[0];
  return [
    { label: "Total", value: formatValue(metric, total) },
    { label: "Daily avg.", value: formatValue(metric, avg) },
    { label: "Peak day", value: peak.label, sub: formatValue(metric, peak.value) },
  ];
}

function buildCompareHighlights(
  rows: Array<{ label: string; value: number }>,
  metric: Metric
): Highlight[] {
  if (rows.length < 2) return [];
  const [a, b] = rows;
  const diff = a.value - b.value;
  const pct =
    b.value === 0 ? 0 : (diff / b.value) * 100;
  return [
    { label: a.label, value: formatValue(metric, a.value) },
    { label: b.label, value: formatValue(metric, b.value) },
    {
      label: "Delta",
      value: `${diff >= 0 ? "+" : ""}${formatValue(metric, diff)}`,
      sub: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs ${b.label}`,
    },
  ];
}
