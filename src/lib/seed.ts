import type Database from "better-sqlite3";

// Deterministic PRNG so the demo is stable across cold starts
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isoDateTime(d: Date): string {
  return d.toISOString();
}

const CATEGORIES = ["Electronics", "Apparel", "Home", "Sports", "Beauty"];

type ProductDef = { sku: string; name: string; category: string; price: number };

function productsFor(prefix: string, vendorSkew: number, rand: () => number): ProductDef[] {
  // Each vendor gets a tuned catalogue to keep charts interesting and distinct.
  const base: ProductDef[] = [
    { sku: `${prefix}-EL-001`, name: "Noise-Canceling Headphones", category: "Electronics", price: 229 },
    { sku: `${prefix}-EL-002`, name: "4K Action Camera", category: "Electronics", price: 349 },
    { sku: `${prefix}-EL-003`, name: "Mechanical Keyboard", category: "Electronics", price: 149 },
    { sku: `${prefix}-EL-004`, name: "USB-C Docking Station", category: "Electronics", price: 189 },
    { sku: `${prefix}-AP-001`, name: "Merino Wool Crewneck", category: "Apparel", price: 89 },
    { sku: `${prefix}-AP-002`, name: "Technical Running Jacket", category: "Apparel", price: 159 },
    { sku: `${prefix}-AP-003`, name: "Waxed Canvas Cap", category: "Apparel", price: 39 },
    { sku: `${prefix}-AP-004`, name: "Selvedge Denim Jeans", category: "Apparel", price: 149 },
    { sku: `${prefix}-HM-001`, name: "Espresso Machine", category: "Home", price: 449 },
    { sku: `${prefix}-HM-002`, name: "Linen Duvet Cover", category: "Home", price: 129 },
    { sku: `${prefix}-HM-003`, name: "Cast Iron Skillet", category: "Home", price: 59 },
    { sku: `${prefix}-HM-004`, name: "Air Purifier", category: "Home", price: 219 },
    { sku: `${prefix}-SP-001`, name: "Trail Running Shoes", category: "Sports", price: 139 },
    { sku: `${prefix}-SP-002`, name: "Yoga Mat Pro", category: "Sports", price: 79 },
    { sku: `${prefix}-SP-003`, name: "Climbing Harness", category: "Sports", price: 99 },
    { sku: `${prefix}-SP-004`, name: "Insulated Water Bottle", category: "Sports", price: 34 },
    { sku: `${prefix}-BT-001`, name: "Vitamin C Serum", category: "Beauty", price: 45 },
    { sku: `${prefix}-BT-002`, name: "Silk Pillowcase", category: "Beauty", price: 55 },
    { sku: `${prefix}-BT-003`, name: "Jade Roller Set", category: "Beauty", price: 28 },
    { sku: `${prefix}-BT-004`, name: "Electric Toothbrush", category: "Beauty", price: 109 },
  ];
  return base.map((p) => ({
    ...p,
    price: Math.round(p.price * (0.9 + rand() * 0.2) * vendorSkew * 100) / 100,
  }));
}

export function seed(db: Database.Database) {
  const rand = mulberry32(0x1234abcd);
  const now = new Date();
  const endDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const DAYS = 90;

  const insertVendor = db.prepare(
    `INSERT INTO vendors (id, company_name, contact_email, status, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, email, region, signup_date) VALUES (?, ?, ?, ?)`
  );
  const insertProduct = db.prepare(
    `INSERT INTO products (id, vendor_id, sku, name, category, unit_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, customer_id, order_date, status, total_amount, shipped_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`
  );
  const insertCancel = db.prepare(
    `INSERT INTO order_cancellations (id, order_id, reason_category, detailed_reason, cancelled_at) VALUES (?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    // Vendors
    const vendorDefs = [
      { id: "supplier_1", name: "Supplier 1", skew: 1.0, email: "ops@supplier1.nextrade.io" },
      { id: "supplier_2", name: "Supplier 2", skew: 0.85, email: "ops@supplier2.nextrade.io" },
    ];
    for (const v of vendorDefs) {
      insertVendor.run(v.id, v.name, v.email, "active", isoDateTime(new Date(endDay.getTime() - 365 * 86400_000)));
    }

    // Customers
    const regions = ["NA", "EU", "APAC", "LATAM"];
    const customers: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `cust_${i.toString().padStart(3, "0")}`;
      customers.push(id);
      insertCustomer.run(
        id,
        `customer${i}@example.com`,
        regions[Math.floor(rand() * regions.length)],
        isoDateTime(new Date(endDay.getTime() - Math.floor(rand() * 500) * 86400_000))
      );
    }

    // Products per vendor
    const vendorProducts: Record<string, ProductDef[]> = {};
    for (const v of vendorDefs) {
      const defs = productsFor(v.id === "supplier_1" ? "S1" : "S2", v.skew, rand);
      vendorProducts[v.id] = defs;
      for (let i = 0; i < defs.length; i++) {
        const p = defs[i];
        const pid = `${v.id}_prod_${i.toString().padStart(3, "0")}`;
        insertProduct.run(
          pid,
          v.id,
          p.sku,
          p.name,
          p.category,
          p.price,
          isoDateTime(new Date(endDay.getTime() - (120 + Math.floor(rand() * 120)) * 86400_000))
        );
      }
    }

    // Product-level popularity weights so top-N has clear winners per vendor
    const popularity: Record<string, number[]> = {};
    for (const v of vendorDefs) {
      const defs = vendorProducts[v.id];
      popularity[v.id] = defs.map(() => 1 + rand() * 4);
      // Crown a couple of hero SKUs
      popularity[v.id][0] *= 2.4;
      popularity[v.id][4] *= 2.0;
      popularity[v.id][12] *= 1.8;
      // Underperformers
      popularity[v.id][7] *= 0.25;
      popularity[v.id][19] *= 0.3;
    }

    // Orders across DAYS
    let orderCounter = 0;
    let itemCounter = 0;
    let cancelCounter = 0;

    for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
      const day = new Date(endDay.getTime() - dayOffset * 86400_000);
      const dow = day.getUTCDay(); // 0 Sun .. 6 Sat

      for (const v of vendorDefs) {
        // Supplier 1 has a mild upward trend; Supplier 2 plateau/slight decline.
        const trendFactor =
          v.id === "supplier_1"
            ? 0.8 + (DAYS - dayOffset) / DAYS / 1.6
            : 1.05 - (DAYS - dayOffset) / DAYS / 4;

        // Day-of-week multiplier: weekends slower, mid-week peak
        const dowMul = [0.55, 0.9, 1.15, 1.25, 1.2, 1.0, 0.6][dow];

        const baseOrders = v.id === "supplier_1" ? 9 : 6;
        const n = Math.max(1, Math.round(baseOrders * dowMul * trendFactor * (0.85 + rand() * 0.3)));

        for (let k = 0; k < n; k++) {
          const orderId = `ord_${orderCounter.toString().padStart(6, "0")}`;
          orderCounter++;
          const customerId = customers[Math.floor(rand() * customers.length)];
          const hour = 8 + Math.floor(rand() * 12);
          const orderAt = new Date(day.getTime() + hour * 3600_000 + Math.floor(rand() * 3600_000));

          // Pick 1–4 items, weighted by popularity
          const defs = vendorProducts[v.id];
          const weights = popularity[v.id];
          const weightSum = weights.reduce((a, b) => a + b, 0);
          const itemCount = 1 + Math.floor(rand() * 3);
          let orderTotal = 0;
          const itemsToInsert: Array<{ pid: string; qty: number; price: number }> = [];
          for (let j = 0; j < itemCount; j++) {
            // weighted pick
            let r = rand() * weightSum;
            let idx = 0;
            for (let q = 0; q < weights.length; q++) {
              r -= weights[q];
              if (r <= 0) {
                idx = q;
                break;
              }
            }
            const p = defs[idx];
            const pid = `${v.id}_prod_${idx.toString().padStart(3, "0")}`;
            const qty = 1 + Math.floor(rand() * 3);
            orderTotal += p.price * qty;
            itemsToInsert.push({ pid, qty, price: p.price });
          }

          // Determine status
          const isCancelled = rand() < 0.1;
          const status = isCancelled ? "cancelled" : "delivered";
          const shippedAt = isCancelled
            ? null
            : isoDateTime(new Date(orderAt.getTime() + 86400_000));
          const deliveredAt = isCancelled
            ? null
            : isoDateTime(new Date(orderAt.getTime() + 4 * 86400_000));

          insertOrder.run(
            orderId,
            customerId,
            isoDateTime(orderAt),
            status,
            Math.round(orderTotal * 100) / 100,
            shippedAt,
            deliveredAt
          );

          for (const it of itemsToInsert) {
            const iid = `itm_${itemCounter.toString().padStart(7, "0")}`;
            itemCounter++;
            insertItem.run(iid, orderId, it.pid, it.qty, it.price);
          }

          if (isCancelled) {
            const cid = `canc_${cancelCounter.toString().padStart(6, "0")}`;
            cancelCounter++;
            // reason_category and detailed_reason remain NULL — we don't capture at checkout.
            insertCancel.run(
              cid,
              orderId,
              null,
              null,
              isoDateTime(new Date(orderAt.getTime() + 6 * 3600_000 + Math.floor(rand() * 86400_000)))
            );
          }
        }
      }
    }
  })();

  // Sanity counts for dev
  const counts = {
    vendors: (db.prepare("SELECT COUNT(*) c FROM vendors").get() as { c: number }).c,
    products: (db.prepare("SELECT COUNT(*) c FROM products").get() as { c: number }).c,
    orders: (db.prepare("SELECT COUNT(*) c FROM orders").get() as { c: number }).c,
    items: (db.prepare("SELECT COUNT(*) c FROM order_items").get() as { c: number }).c,
    cancellations: (db.prepare("SELECT COUNT(*) c FROM order_cancellations").get() as { c: number }).c,
  };
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[nextrade] seeded db", counts);
  }
}
