import { cookies } from "next/headers";
import { SUPPLIER_IDS, type SupplierId } from "./db";

const COOKIE = "nt_supplier";

export async function getCurrentSupplierId(): Promise<SupplierId> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (raw && (SUPPLIER_IDS as readonly string[]).includes(raw)) {
    return raw as SupplierId;
  }
  return "supplier_1";
}

export async function setCurrentSupplierId(id: SupplierId): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export const SUPPLIER_COOKIE = COOKIE;
