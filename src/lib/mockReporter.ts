import type { AssistantReply } from "./types";
import type { SupplierId } from "./db";
import {
  metricByDimension,
  trendByDay,
  summaryStats,
  compareTwoRanges,
} from "./queries";

/**
 * Deterministic keyword-based intent classifier used when NEXTRADE_MOCK=1.
 * Lets us validate UI / data / isolation end-to-end without calling the LLM.
 * Real traffic goes through runReport() (Anthropic tool-use).
 */
export async function runMockReport(opts: {
  vendorId: SupplierId;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AssistantReply> {
  const vendorId = opts.vendorId;
  const q = opts.userMessage.toLowerCase();

  // Unsupported: "why" questions about cancellation/return reasons
  if (/\bwhy\b/.test(q) && /(cancel|return)/.test(q)) {
    return {
      text: "I can tell you how many cancellations you had — but not why.",
      unsupported: {
        reason:
          "The platform doesn't capture cancellation reasons at checkout, so I have no data to explain customer motivation.",
        suggestions: [
          "What's my cancellation rate last month?",
          "Show cancellations per day for the last 30 days",
          "How does my cancellation rate compare to last month?",
        ],
      },
    };
  }

  // Summary
  if (/(snapshot|overview|summary|how am i doing|how are sales)/.test(q)) {
    const tf = /this month/.test(q)
      ? ({ type: "this_month" } as const)
      : ({ type: "last_n_days", n: 30 } as const);
    const stats = summaryStats(vendorId, tf);
    return {
      text: "Here's a snapshot of your recent performance.",
      highlights: [
        { label: "Revenue", value: fmt$(stats.totalRevenue), sub: stats.rangeLabel },
        { label: "Orders", value: fmtN(stats.orderCount), sub: stats.rangeLabel },
        { label: "Units sold", value: fmtN(stats.unitsSold), sub: stats.rangeLabel },
        {
          label: "Cancellation rate",
          value: `${(stats.cancellationRate * 100).toFixed(1)}%`,
          sub: stats.rangeLabel,
        },
        { label: "Avg. order value", value: fmt$(stats.aov), sub: stats.rangeLabel },
        { label: "Active products", value: fmtN(stats.productCount) },
      ],
    };
  }

  // Day-vs-day compare
  if (/compare|vs\.?|versus/.test(q) && /(mon|tue|wed|thu|fri|sat|sun)/.test(q)) {
    const { rows } = compareTwoRanges({
      vendorId,
      metric: "revenue",
      a: { type: "last_n_days", n: 7 },
      b: { type: "last_n_days", n: 7 },
      labelA: "Tuesday",
      labelB: "Wednesday",
    });
    // For mock, use day-of-week data instead
    const dow = metricByDimension({
      vendorId,
      metric: "revenue",
      dimension: "day_of_week",
      timeframe: { type: "last_n_days", n: 30 },
    });
    const tue = dow.rows.find((r) => r.label === "Tue")?.value ?? 0;
    const wed = dow.rows.find((r) => r.label === "Wed")?.value ?? 0;
    rows[0] = { label: "Tuesday", value: Math.round(tue * 100) / 100 };
    rows[1] = { label: "Wednesday", value: Math.round(wed * 100) / 100 };
    const delta = rows[1].value - rows[0].value;
    return {
      text: "Here's how your Tuesday and Wednesday revenue stack up.",
      chart: {
        type: "bar",
        title: "Tuesday vs Wednesday · revenue (last 30 days)",
        xKey: "label",
        yKey: "value",
        data: rows,
        valueFormat: "currency",
      },
      highlights: [
        { label: "Tuesday", value: fmt$(rows[0].value) },
        { label: "Wednesday", value: fmt$(rows[1].value) },
        {
          label: "Delta",
          value: `${delta >= 0 ? "+" : ""}${fmt$(delta)}`,
          sub: `${((delta / (rows[0].value || 1)) * 100).toFixed(1)}%`,
        },
      ],
    };
  }

  // Cancellation rate
  if (/cancellation (rate|%)|cancel.*rate/.test(q)) {
    const tf = /last month/.test(q)
      ? ({ type: "last_month" } as const)
      : ({ type: "last_n_days", n: 30 } as const);
    const { rows, rangeLabel } = metricByDimension({
      vendorId,
      metric: "cancellation_count",
      dimension: "date",
      timeframe: tf,
    });
    return {
      text: "Here's your cancellation volume over the period.",
      chart: {
        type: "line",
        title: `Cancellations · ${rangeLabel}`,
        xKey: "label",
        yKey: "value",
        data: rows.map((r) => ({ label: r.label, value: r.value })),
        valueFormat: "count",
      },
    };
  }

  // Revenue trend
  if (/trend|over time|last 30|last thirty|daily revenue|past month/.test(q)) {
    const n = /last 7|seven/.test(q) ? 7 : /last 14/.test(q) ? 14 : 30;
    const { rows, rangeLabel } = trendByDay({
      vendorId,
      metric: "revenue",
      timeframe: { type: "last_n_days", n },
    });
    const total = rows.reduce((s, r) => s + r.value, 0);
    const peak = [...rows].sort((a, b) => b.value - a.value)[0];
    return {
      text: `Here's your revenue trend for the ${rangeLabel}.`,
      chart: {
        type: "line",
        title: `Revenue · ${rangeLabel}`,
        xKey: "label",
        yKey: "value",
        data: rows.map((r) => ({ label: r.date, value: r.value })),
        valueFormat: "currency",
      },
      highlights: [
        { label: "Total", value: fmt$(total) },
        { label: "Daily avg.", value: fmt$(total / Math.max(rows.length, 1)) },
        { label: "Peak day", value: peak?.date ?? "—", sub: peak ? fmt$(peak.value) : undefined },
      ],
    };
  }

  // Category breakdown
  if (/category|categories|breakdown/.test(q)) {
    const tf = /this month/.test(q)
      ? ({ type: "this_month" } as const)
      : /last month/.test(q)
      ? ({ type: "last_month" } as const)
      : ({ type: "last_n_days", n: 30 } as const);
    const { rows, rangeLabel } = metricByDimension({
      vendorId,
      metric: "revenue",
      dimension: "category",
      timeframe: tf,
    });
    const top = rows[0];
    const total = rows.reduce((s, r) => s + r.value, 0);
    return {
      text: "Here's how your revenue breaks down by category.",
      chart: {
        type: "pie",
        title: `Category mix · ${rangeLabel}`,
        xKey: "label",
        yKey: "value",
        data: rows,
        valueFormat: "currency",
      },
      highlights: top
        ? [
            { label: "Top category", value: top.label, sub: fmt$(top.value) },
            { label: "Total", value: fmt$(total) },
            {
              label: "Top share",
              value: `${((top.value / Math.max(total, 1)) * 100).toFixed(1)}%`,
            },
          ]
        : [],
    };
  }

  // Top / worst products (default)
  const isWorst = /worst|bottom|lowest|slowest/.test(q);
  const limitMatch = q.match(/top\s*(\d+)|bottom\s*(\d+)|(\d+)\s*worst/);
  const limit =
    (limitMatch && Number(limitMatch[1] || limitMatch[2] || limitMatch[3])) || 5;
  const tf = /last month/.test(q)
    ? ({ type: "last_month" } as const)
    : /this month/.test(q)
    ? ({ type: "this_month" } as const)
    : ({ type: "last_n_days", n: 30 } as const);
  const { rows, rangeLabel } = metricByDimension({
    vendorId,
    metric: "revenue",
    dimension: "product",
    timeframe: tf,
    limit,
    sort: isWorst ? "asc" : "desc",
  });
  const top = rows[0];
  const total = rows.reduce((s, r) => s + r.value, 0);
  return {
    text: isWorst
      ? `Here are your ${limit} slowest products by revenue.`
      : `Here are your top ${limit} products by revenue.`,
    chart: {
      type: "bar",
      title: `${isWorst ? "Bottom" : "Top"} ${limit} products · ${rangeLabel}`,
      xKey: "label",
      yKey: "value",
      data: rows,
      valueFormat: "currency",
    },
    highlights: top
      ? [
          {
            label: isWorst ? "Slowest" : "Top product",
            value: top.label,
            sub: fmt$(top.value),
          },
          { label: "Total (shown)", value: fmt$(total) },
        ]
      : [],
  };
}

function fmt$(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}
function fmtN(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
