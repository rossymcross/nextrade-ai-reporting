import { NextResponse } from "next/server";
import { getCurrentSupplierId } from "@/lib/session";
import { runReport } from "@/lib/reporter";
import { runMockReport } from "@/lib/mockReporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").toString().trim();
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (message.length > 600) {
    return NextResponse.json(
      { error: "Message too long (max 600 chars)" },
      { status: 400 }
    );
  }

  // CRITICAL: vendorId is pulled from the session cookie server-side.
  // It is never read from the request body and never exposed to the LLM.
  const vendorId = await getCurrentSupplierId();

  const history = (body.history || [])
    .slice(-6)
    .filter((h) => h && typeof h.content === "string" && h.content.length <= 1000)
    .map((h) => ({
      role: h.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: h.content,
    }));

  try {
    const runner = process.env.NEXTRADE_MOCK === "1" ? runMockReport : runReport;
    const reply = await runner({ vendorId, userMessage: message, history });
    return NextResponse.json(reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[chat] error", err);
    return NextResponse.json(
      {
        text:
          "I hit an error generating that report. Please try again in a moment.",
        debug: { error: msg, supplierId: vendorId },
      },
      { status: 200 }
    );
  }
}
