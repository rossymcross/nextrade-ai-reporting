"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/types";

const TEAL = "#008080";
const LIME = "#39FF14";
const CATEGORY_COLORS = [
  "#008080",
  "#39FF14",
  "#4c7570",
  "#66b2b2",
  "#1a1a1a",
  "#99cccc",
  "#006b6b",
];

function formatValue(v: number, fmt: ChartSpec["valueFormat"]): string {
  if (fmt === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: v >= 1000 ? 0 : 2,
    }).format(v);
  }
  if (fmt === "percent") {
    return `${(v * 100).toFixed(1)}%`;
  }
  return new Intl.NumberFormat("en-US").format(Math.round(v));
}

function formatAxisShort(v: number, fmt: ChartSpec["valueFormat"]): string {
  if (fmt === "percent") return `${(v * 100).toFixed(0)}%`;
  const abs = Math.abs(v);
  if (abs >= 1_000_000)
    return `${fmt === "currency" ? "$" : ""}${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000)
    return `${fmt === "currency" ? "$" : ""}${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `${fmt === "currency" ? "$" : ""}${v.toFixed(0)}`;
}

function formatXDate(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const [, m, d] = label.split("-");
    return `${m}/${d}`;
  }
  return label;
}

const tooltipStyle = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  padding: "8px 10px",
} as const;

export function ChartView({ spec }: { spec: ChartSpec }) {
  if (!spec.data.length) {
    return (
      <div className="py-6 text-sm text-[var(--color-muted)]">
        No data for that range.
      </div>
    );
  }

  const isTimeSeries = /^\d{4}-\d{2}-\d{2}$/.test(String(spec.data[0][spec.xKey]));

  if (spec.type === "line") {
    return (
      <div style={{ width: "100%", height: 260 }} className="mt-3">
        <ResponsiveContainer>
          <LineChart
            data={spec.data}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
          >
            <CartesianGrid
              stroke="#e5e7eb"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey={spec.xKey}
              tickFormatter={(v) => (isTimeSeries ? formatXDate(String(v)) : String(v))}
              stroke="#4c7570"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              minTickGap={24}
            />
            <YAxis
              stroke="#4c7570"
              fontSize={11}
              tickFormatter={(v) => formatAxisShort(Number(v), spec.valueFormat)}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              width={54}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ fontSize: 12, color: "#1a1a1a" }}
              itemStyle={{ fontSize: 12, color: "#1a1a1a" }}
              formatter={(v) => [formatValue(Number(v), spec.valueFormat), spec.title]}
              labelFormatter={(l) => (isTimeSeries ? formatXDate(String(l)) : String(l))}
            />
            <Line
              type="monotone"
              dataKey={spec.yKey}
              stroke={TEAL}
              strokeWidth={2.25}
              dot={{ r: 2.5, fill: TEAL, stroke: TEAL }}
              activeDot={{ r: 4, fill: LIME, stroke: TEAL, strokeWidth: 1 }}
              isAnimationActive
              animationDuration={600}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "pie") {
    return (
      <div className="mt-3 grid grid-cols-[1fr,160px] gap-4 items-center">
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={spec.data}
                dataKey={spec.yKey}
                nameKey={spec.xKey}
                cx="50%"
                cy="50%"
                innerRadius={52}
                outerRadius={92}
                stroke="#fff"
                strokeWidth={2}
                isAnimationActive
                animationDuration={600}
              >
                {spec.data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, n) => [
                  formatValue(Number(v), spec.valueFormat),
                  n as string,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="text-xs flex flex-col gap-1.5 text-[var(--color-ink)] self-center">
          {spec.data.map((row, i) => (
            <li key={i} className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
              />
              <span className="truncate" style={{ maxWidth: 96 }}>
                {String(row[spec.xKey])}
              </span>
              <span className="mono text-[var(--color-muted)] ml-auto">
                {formatValue(Number(row[spec.yKey]), spec.valueFormat)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // bar
  const max = Math.max(...spec.data.map((d) => Number(d[spec.yKey]) || 0));
  return (
    <div style={{ width: "100%", height: 260 }} className="mt-3">
      <ResponsiveContainer>
        <BarChart
          data={spec.data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid
            stroke="#e5e7eb"
            strokeDasharray="2 4"
            vertical={false}
          />
          <XAxis
            dataKey={spec.xKey}
            stroke="#4c7570"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            interval={0}
            tickFormatter={(v) => {
              const s = String(v);
              return s.length > 14 ? s.slice(0, 12) + "…" : s;
            }}
          />
          <YAxis
            stroke="#4c7570"
            fontSize={11}
            tickFormatter={(v) => formatAxisShort(Number(v), spec.valueFormat)}
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            width={54}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ fontSize: 12, color: "#1a1a1a" }}
            itemStyle={{ fontSize: 12, color: "#1a1a1a" }}
            formatter={(v) => [formatValue(Number(v), spec.valueFormat), spec.title]}
          />
          <Bar
            dataKey={spec.yKey}
            radius={[3, 3, 0, 0]}
            isAnimationActive
            animationDuration={600}
          >
            {spec.data.map((d, i) => (
              <Cell
                key={i}
                fill={Number(d[spec.yKey]) === max ? LIME : TEAL}
                stroke={Number(d[spec.yKey]) === max ? "#1a1a1a" : "transparent"}
                strokeWidth={Number(d[spec.yKey]) === max ? 0.75 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
