import { Chat } from "@/components/Chat";
import { SUPPLIERS, SUPPLIER_IDS } from "@/lib/db";
import { getCurrentSupplierId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supplier = await getCurrentSupplierId();
  const suppliers = SUPPLIER_IDS.map((id) => ({
    id: SUPPLIERS[id].id,
    name: SUPPLIERS[id].name,
  }));
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Chat initialSupplier={supplier} suppliers={suppliers} />
    </div>
  );
}
