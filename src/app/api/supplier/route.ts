import { NextResponse } from "next/server";
import { SUPPLIERS, SUPPLIER_IDS, type SupplierId } from "@/lib/db";
import { getCurrentSupplierId, setCurrentSupplierId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const current = await getCurrentSupplierId();
  return NextResponse.json({
    current,
    suppliers: SUPPLIER_IDS.map((id) => SUPPLIERS[id]),
  });
}

export async function POST(request: Request) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = body.id;
  if (!id || !(SUPPLIER_IDS as readonly string[]).includes(id)) {
    return NextResponse.json({ error: "Invalid supplier id" }, { status: 400 });
  }
  await setCurrentSupplierId(id as SupplierId);
  return NextResponse.json({ current: id });
}
