CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  why TEXT NOT NULL,
  evidence TEXT NOT NULL,
  dose TEXT NOT NULL,
  testing TEXT NOT NULL,
  halal TEXT NOT NULL,
  mal TEXT NOT NULL,
  audience TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  list_price_cents INTEGER NOT NULL,
  shopee_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  gateway TEXT NOT NULL,
  provider_ref TEXT,
  created_day TEXT NOT NULL,
  consent INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
