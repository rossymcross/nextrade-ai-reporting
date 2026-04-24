import Database from "better-sqlite3";
import { seed } from "./seed";

export const SUPPLIER_IDS = ["supplier_1", "supplier_2"] as const;
export type SupplierId = (typeof SUPPLIER_IDS)[number];

export const SUPPLIERS: Record<SupplierId, { id: SupplierId; name: string }> = {
  supplier_1: { id: "supplier_1", name: "Supplier 1" },
  supplier_2: { id: "supplier_2", name: "Supplier 2" },
};

const g = globalThis as unknown as { __nextradeDb?: Database.Database };

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE vendors (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      region TEXT NOT NULL,
      signup_date TEXT NOT NULL
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_price REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_products_vendor ON products(vendor_id);

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      order_date TEXT NOT NULL,
      status TEXT NOT NULL,
      total_amount REAL NOT NULL,
      shipped_at TEXT,
      delivered_at TEXT
    );
    CREATE INDEX idx_orders_date ON orders(order_date);

    CREATE TABLE order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE INDEX idx_items_order ON order_items(order_id);
    CREATE INDEX idx_items_product ON order_items(product_id);

    CREATE TABLE order_cancellations (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
      reason_category TEXT,
      detailed_reason TEXT,
      cancelled_at TEXT NOT NULL
    );
  `);

  seed(db);
  return db;
}

export function getDb(): Database.Database {
  if (!g.__nextradeDb) {
    g.__nextradeDb = createDb();
  }
  return g.__nextradeDb;
}
