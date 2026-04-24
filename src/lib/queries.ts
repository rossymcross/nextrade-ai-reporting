import { getDb, SUPPLIER_IDS, type SupplierId } from "./db";

/**
 * All queries take vendorId as the first, required argument and hardcode
 * `WHERE vendor_id = ?` against the products table. The LLM never writes SQL
 * and never receives a vendorId from the client — it is pulled from the
 * signed session cookie by the API route and passed in here directly.
 */

export type Metric =
  | "revenue"
  | "units_sold"
  | "order_count"
  | "cancellation_count"
  | "cancellation_rate"
  | "aov";

export type Dimension = "date" | "day_of_week" | "product" | "category";

export type Timeframe =
  | { type: "last_n_days"; n: number }
  | { type: "this_month" }
  | { type: "last_month" }
  | { type: "this_week" }
  | { type: "last_week" }
  | { type: "specific_day"; date: string } // YYYY-MM-DD
  | { type: "date_range"; start: string; end: string };

export function assertVendorId(id: string): SupplierId {
  if (!(SUPPLIER_IDS as readonly string[]).includes(id)) {
    throw new Error(`Invalid vendor id`);
  }
  return id as SupplierId;
}

function metricExpr(metric: Metric): string {
  switch (metric) {
    case "revenue":
      return "SUM(oi.quantity * oi.unit_price)";
    case "units_sold":
      return "SUM(oi.quantity)";
    case "order_count":
      return "COUNT(DISTINCT o.id)";
    case "cancellation_count":
      return "SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END)";
    case "cancellation_rate":
      return "AVG(CASE WHEN o.status = 'cancelled' THEN 1.0 ELSE 0 END)";
    case "aov":
      return "AVG(o.total_amount)";
  }
}

export function metricLabel(metric: Metric): string {
  switch (metric) {
    case "revenue":
      return "Revenue";
    case "units_sold":
      return "Units sold";
    case "order_count":
      return "Orders";
    case "cancellation_count":
      return "Cancellations";
    case "cancellation_rate":
      return "Cancellation rate";
    case "aov":
      return "Average order value";
  }
}

export function dimensionLabel(dim: Dimension): string {
  return (
    {
      date: "Date",
      day_of_week: "Day of week",
      product: "Product",
      category: "Category",
    } as const
  )[dim];
}

type RangeClause = { sql: string; label: string };

function timeframeClause(tf: Timeframe): RangeClause {
  switch (tf.type) {
    case "last_n_days":
      return {
        sql: `o.order_date >= date('now','-${tf.n} days')`,
        label: `last ${tf.n} days`,
      };
    case "this_month":
      return {
        sql: `strftime('%Y-%m', o.order_date) = strftime('%Y-%m', 'now')`,
        label: "this month",
      };
    case "last_month":
      return {
        sql: `strftime('%Y-%m', o.order_date) = strftime('%Y-%m', date('now','start of month','-1 day'))`,
        label: "last month",
      };
    case "this_week":
      return {
        sql: `strftime('%Y-%W', o.order_date) = strftime('%Y-%W', 'now')`,
        label: "this week",
      };
    case "last_week":
      return {
        sql: `strftime('%Y-%W', o.order_date) = strftime('%Y-%W', date('now','-7 days'))`,
        label: "last week",
      };
    case "specific_day":
      return {
        sql: `date(o.order_date) = date('${tf.date.replace(/'/g, "")}')`,
        label: tf.date,
      };
    case "date_range":
      return {
        sql: `date(o.order_date) BETWEEN date('${tf.start.replace(/'/g, "")}') AND date('${tf.end.replace(/'/g, "")}')`,
        label: `${tf.start}–${tf.end}`,
      };
  }
}

function dimensionExpr(dim: Dimension): { sql: string; alias: string } {
  switch (dim) {
    case "date":
      return { sql: "date(o.order_date)", alias: "date" };
    case "day_of_week":
      return { sql: "strftime('%w', o.order_date)", alias: "dow" };
    case "product":
      return { sql: "p.name", alias: "product" };
    case "category":
      return { sql: "p.category", alias: "category" };
  }
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type MetricByDimensionRow = { label: string; value: number };

export function metricByDimension(opts: {
  vendorId: SupplierId;
  metric: Metric;
  dimension: Dimension;
  timeframe: Timeframe;
  limit?: number;
  sort?: "asc" | "desc";
  includeCancellations?: boolean; // for cancellation metrics
}): { rows: MetricByDimensionRow[]; rangeLabel: string } {
  const db = getDb();
  const vendorId = assertVendorId(opts.vendorId);
  const dim = dimensionExpr(opts.dimension);
  const range = timeframeClause(opts.timeframe);
  const mExpr = metricExpr(opts.metric);
  const excludeCancelled =
    opts.metric === "cancellation_count" || opts.metric === "cancellation_rate"
      ? ""
      : `AND o.status <> 'cancelled'`;
  const sortDir =
    opts.sort === "asc" ? "ASC" : opts.sort === "desc" ? "DESC" : "DESC";
  const limitSql = opts.limit ? `LIMIT ${Math.min(100, Math.max(1, opts.limit | 0))}` : "";

  const sql = `
    SELECT ${dim.sql} AS ${dim.alias}, ${mExpr} AS value
    FROM products p
    JOIN order_items oi ON oi.product_id = p.id
    JOIN orders o ON o.id = oi.order_id
    WHERE p.vendor_id = ?
      AND ${range.sql}
      ${excludeCancelled}
    GROUP BY ${dim.sql}
    ORDER BY ${opts.dimension === "date" ? dim.alias : "value"} ${opts.dimension === "date" ? "ASC" : sortDir}
    ${limitSql}
  `;

  const rows = db.prepare(sql).all(vendorId) as Array<Record<string, unknown>>;
  const shaped: MetricByDimensionRow[] = rows.map((r) => {
    const v = Number(r.value ?? 0);
    const rawLabel = r[dim.alias];
    let label: string;
    if (opts.dimension === "day_of_week") {
      label = DOW_NAMES[Number(rawLabel)];
    } else {
      label = String(rawLabel ?? "");
    }
    return { label, value: Math.round(v * 100) / 100 };
  });

  // If day_of_week, order Mon..Sun
  if (opts.dimension === "day_of_week") {
    const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    shaped.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  }

  return { rows: shaped, rangeLabel: range.label };
}

export type TrendPoint = { date: string; value: number };

export function trendByDay(opts: {
  vendorId: SupplierId;
  metric: Metric;
  timeframe: Timeframe;
}): { rows: TrendPoint[]; rangeLabel: string } {
  const { rows, rangeLabel } = metricByDimension({
    vendorId: opts.vendorId,
    metric: opts.metric,
    dimension: "date",
    timeframe: opts.timeframe,
  });
  return {
    rows: rows.map((r) => ({ date: r.label, value: r.value })),
    rangeLabel,
  };
}

export type ComparePoint = { label: string; value: number };

export function compareTwoRanges(opts: {
  vendorId: SupplierId;
  metric: Metric;
  a: Timeframe;
  b: Timeframe;
  labelA: string;
  labelB: string;
}): { rows: ComparePoint[] } {
  const a = metricByDimension({
    vendorId: opts.vendorId,
    metric: opts.metric,
    dimension: "date",
    timeframe: opts.a,
  });
  const b = metricByDimension({
    vendorId: opts.vendorId,
    metric: opts.metric,
    dimension: "date",
    timeframe: opts.b,
  });
  const sumA = a.rows.reduce((s, r) => s + r.value, 0);
  const sumB = b.rows.reduce((s, r) => s + r.value, 0);
  return {
    rows: [
      { label: opts.labelA, value: Math.round(sumA * 100) / 100 },
      { label: opts.labelB, value: Math.round(sumB * 100) / 100 },
    ],
  };
}

export type SummaryStats = {
  totalRevenue: number;
  orderCount: number;
  unitsSold: number;
  cancellationRate: number;
  aov: number;
  productCount: number;
  rangeLabel: string;
};

export function summaryStats(
  vendorId: SupplierId,
  timeframe: Timeframe
): SummaryStats {
  const db = getDb();
  const range = timeframeClause(timeframe);

  const base = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN oi.quantity * oi.unit_price ELSE 0 END), 0) AS revenue,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN oi.quantity ELSE 0 END), 0) AS units,
      AVG(CASE WHEN o.status = 'cancelled' THEN 1.0 ELSE 0 END) AS cancel_rate,
      AVG(CASE WHEN o.status <> 'cancelled' THEN o.total_amount ELSE NULL END) AS aov
    FROM products p
    JOIN order_items oi ON oi.product_id = p.id
    JOIN orders o ON o.id = oi.order_id
    WHERE p.vendor_id = ? AND ${range.sql}
  `
    )
    .get(vendorId) as {
    revenue: number;
    order_count: number;
    units: number;
    cancel_rate: number | null;
    aov: number | null;
  };

  const pc = db
    .prepare(`SELECT COUNT(*) c FROM products WHERE vendor_id = ?`)
    .get(vendorId) as { c: number };

  return {
    totalRevenue: Math.round((base.revenue ?? 0) * 100) / 100,
    orderCount: base.order_count ?? 0,
    unitsSold: base.units ?? 0,
    cancellationRate: Math.round(((base.cancel_rate ?? 0) as number) * 10000) / 10000,
    aov: Math.round(((base.aov ?? 0) as number) * 100) / 100,
    productCount: pc.c,
    rangeLabel: range.label,
  };
}
