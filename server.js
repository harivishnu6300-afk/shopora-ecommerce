require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn("WARNING: Set JWT_SECRET to a random string of at least 32 characters before production.");
}
const secret = JWT_SECRET || "local-development-only-secret-change-before-deploy-123456";

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "shopora.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  image TEXT NOT NULL,
  badge TEXT DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Placed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wishlists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, product_id)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id)
);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  discount_percent INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO coupons(code, discount_percent, active) VALUES ('WELCOME10', 10, 1);
`);

// Safe schema upgrades for existing Shopora databases.
ensureColumn("users", "address", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "address", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "coupon", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "discount", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("orders", "phone", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "payment_method", "TEXT NOT NULL DEFAULT 'COD'");

const productCount = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (productCount === 0) {
  const insert = db.prepare(`INSERT INTO products (name, description, category, price, image, badge, stock)
    VALUES (@name, @description, @category, @price, @image, @badge, @stock)`);
  const seed = [
    {name:"Wireless Headphones",description:"Rich sound, soft ear cushions and all-day comfort.",category:"Electronics",price:2499,image:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85",badge:"BESTSELLER",stock:30},
    {name:"Everyday Sneakers",description:"Lightweight everyday sneakers with a clean silhouette.",category:"Fashion",price:1899,image:"https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85",badge:"TRENDING",stock:24},
    {name:"Minimal Wrist Watch",description:"A timeless everyday watch with a modern finish.",category:"Accessories",price:3299,image:"https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=900&q=85",badge:"NEW",stock:18},
    {name:"Daily Carry Backpack",description:"Roomy, practical storage for work, college and travel.",category:"Accessories",price:1599,image:"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85",badge:"",stock:22},
    {name:"Smart Desk Lamp",description:"Warm adjustable lighting for focused work and reading.",category:"Home",price:1199,image:"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85",badge:"",stock:20},
    {name:"Classic Sunglasses",description:"Versatile frames for sunny days and weekend plans.",category:"Fashion",price:899,image:"https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=900&q=85",badge:"POPULAR",stock:40},
    {name:"Portable Speaker",description:"Compact design with punchy sound for every occasion.",category:"Electronics",price:2199,image:"https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=85",badge:"",stock:16},
    {name:"Ceramic Coffee Set",description:"A simple ceramic cup set for slow mornings.",category:"Home",price:749,image:"https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=85",badge:"",stock:35}
  ];
  const seedTx = db.transaction(items => items.forEach(p => insert.run({...p, stock: p.stock || 20})));
  seedTx(seed);
}

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please log in to continue." });
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, address: user.address || "", isAdmin: Boolean(process.env.ADMIN_EMAIL && user.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()) };
}

app.get("/api/health", (req, res) => res.json({ ok: true, app: "Shopora" }));
app.get("/api/products", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  const category = String(req.query.category || "").trim().slice(0, 40);
  let rows;
  if (q && category && category !== "All") {
    rows = db.prepare("SELECT * FROM products WHERE (name LIKE ? OR description LIKE ?) AND category = ? ORDER BY id DESC")
      .all(`%${q}%`, `%${q}%`, category);
  } else if (q) {
    rows = db.prepare("SELECT * FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY id DESC").all(`%${q}%`, `%${q}%`);
  } else if (category && category !== "All") {
    rows = db.prepare("SELECT * FROM products WHERE category = ? ORDER BY id DESC").all(category);
  } else {
    rows = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
  }
  res.json(rows);
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: "Name must be 2–60 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8 || password.length > 100) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(name, email, hash);
    const user = { id: result.lastInsertRowid, name, email };
    const token = jwt.sign({ id: user.id, email }, secret, { expiresIn: "7d" });
    res.status(201).json({ token, user });
  } catch (err) {
    if (String(err.code) === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That email is already registered." });
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: "7d" });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT id, name, email, address FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(401).json({ error: "Account not found." });
  res.json({ user: { ...user, isAdmin: Boolean(process.env.ADMIN_EMAIL && user.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()) } });
});

const createOrder = db.transaction((userId, items, address = "", couponCode = "", phone = "", paymentMethod = "COD") => {
  let total = 0;
  const checked = [];
  for (const item of items) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Invalid product or quantity.");
    }
    const product = db.prepare("SELECT id, name, price, stock FROM products WHERE id = ?").get(productId);
    if (!product) throw new Error("A product in your cart is no longer available.");
    if (product.stock < quantity) throw new Error(`${product.name} does not have enough stock.`);
    total += product.price * quantity;
    checked.push({ product, quantity });
  }
  if (!checked.length) throw new Error("Your cart is empty.");
  let discount = 0, validCode = "";
  if (couponCode) {
    const coupon = db.prepare("SELECT code, discount_percent FROM coupons WHERE code=? AND active=1").get(String(couponCode).toUpperCase());
    if (!coupon) throw new Error("Invalid coupon code.");
    validCode = coupon.code; discount = Math.floor(total * coupon.discount_percent / 100); total -= discount;
  }
  const order = db.prepare("INSERT INTO orders (user_id, total, address, coupon, discount, phone, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, total, String(address).slice(0,300), validCode, discount, String(phone).slice(0,30), String(paymentMethod).slice(0,40));
  const addItem = db.prepare("INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)");
  const reduceStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
  checked.forEach(({product, quantity}) => {
    addItem.run(order.lastInsertRowid, product.id, product.name, quantity, product.price);
    reduceStock.run(quantity, product.id);
  });
  return { id: order.lastInsertRowid, total };
});

app.post("/api/orders", auth, (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length > 30) return res.status(400).json({ error: "Too many different products in one order." });
    const address = String(req.body.address || "").trim();
    const phone = String(req.body.phone || "").trim();
    const paymentMethod = String(req.body.paymentMethod || "").trim();
    if (address.length < 8) return res.status(400).json({ error: "Enter your complete delivery address (at least 8 characters)." });
    if (!/^[+0-9()\-\s]{8,20}$/.test(phone)) return res.status(400).json({ error: "Enter a valid contact phone number." });
    if (!["COD", "UPI", "CARD"].includes(paymentMethod)) return res.status(400).json({ error: "Choose a payment method." });
    if (paymentMethod === "UPI" && String(req.body.paymentReference || "").trim().length < 4) return res.status(400).json({ error: "Enter your UPI transaction reference. Online payment is not verified by this demo." });
    if (paymentMethod === "CARD") return res.status(400).json({ error: "Card payments are not enabled yet. Configure a payment gateway before accepting card payments." });
    const order = createOrder(req.user.id, items, address, String(req.body.coupon || ""), phone, paymentMethod);
    res.status(201).json({ message: "Order placed successfully!", order });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not place order." });
  }
});

app.get("/api/orders", auth, (req, res) => {
  const orders = db.prepare("SELECT id, total, status, created_at, address, phone, payment_method, coupon, discount FROM orders WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  const getItems = db.prepare("SELECT product_name, quantity, unit_price FROM order_items WHERE order_id = ?");
  res.json(orders.map(order => ({ ...order, items: getItems.all(order.id) })));
});

// Customers may cancel only their own not-yet-cancelled orders; stock is restored once atomically.
const cancelOrderTx = db.transaction((orderId, userId) => {
  const order = db.prepare("SELECT id, status FROM orders WHERE id = ? AND user_id = ?").get(orderId, userId);
  if (!order) throw new Error("Order not found.");
  if (order.status === "Cancelled") throw new Error("This order is already cancelled.");
  if (order.status !== "Placed") throw new Error("This order can no longer be cancelled. Contact support.");
  const items = db.prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?").all(orderId);
  const restock = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
  items.forEach(item => restock.run(item.quantity, item.product_id));
  db.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(orderId);
  return { id: orderId, status: "Cancelled" };
});
app.post("/api/orders/:id/cancel", auth, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid order ID." });
    res.json({ message: "Order cancelled and stock restored.", order: cancelOrderTx(id, req.user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not cancel order." });
  }
});

app.put("/api/me", auth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  const address = String(req.body.address || "").trim().slice(0, 300);
  if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
  db.prepare("UPDATE users SET name = ?, address = ? WHERE id = ?").run(name, address, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});
app.get("/api/wishlist", auth, (req, res) => {
  res.json(db.prepare(`SELECT p.* FROM products p JOIN wishlists w ON w.product_id=p.id WHERE w.user_id=? ORDER BY w.created_at DESC`).all(req.user.id));
});
app.post("/api/wishlist/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT id FROM products WHERE id=?").get(id)) return res.status(404).json({ error: "Product not found." });
  const exists = db.prepare("SELECT 1 FROM wishlists WHERE user_id=? AND product_id=?").get(req.user.id, id);
  if (exists) db.prepare("DELETE FROM wishlists WHERE user_id=? AND product_id=?").run(req.user.id, id);
  else db.prepare("INSERT INTO wishlists(user_id, product_id) VALUES (?,?)").run(req.user.id, id);
  res.json({ saved: !exists });
});
app.get("/api/products/:id/reviews", (req, res) => {
  const id = Number(req.params.id);
  res.json(db.prepare(`SELECT r.id,r.rating,r.comment,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.id DESC`).all(id));
});
app.post("/api/products/:id/reviews", auth, (req, res) => {
  const productId = Number(req.params.id), rating = Number(req.body.rating), comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Choose a rating from 1 to 5." });
  if (!db.prepare("SELECT id FROM products WHERE id=?").get(productId)) return res.status(404).json({ error: "Product not found." });
  db.prepare(`INSERT INTO reviews(user_id,product_id,rating,comment) VALUES (?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,created_at=CURRENT_TIMESTAMP`).run(req.user.id, productId, rating, comment);
  res.json({ message: "Review saved." });
});
app.post("/api/coupons/validate", (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const coupon = db.prepare("SELECT code,discount_percent FROM coupons WHERE code=? AND active=1").get(code);
  if (!coupon) return res.status(400).json({ error: "Invalid coupon code." });
  res.json(coupon);
});
function adminOnly(req, res, next) {
  if (!process.env.ADMIN_EMAIL || String(req.user.email).toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) return res.status(403).json({ error: "Admin access is not enabled for this account." });
  next();
}
app.post("/api/admin/products", auth, adminOnly, (req, res) => {
  const p = req.body || {};
  const name = String(p.name || "").trim().slice(0,100), description = String(p.description || "").trim().slice(0,500), category = String(p.category || "General").trim().slice(0,40), image = String(p.image || "https://placehold.co/600x500?text=Shopora").trim().slice(0,500), price = Number(p.price), stock = Number(p.stock);
  if (!name || !Number.isInteger(price) || price < 1 || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: "Enter a product name, valid price and stock." });
  const result = db.prepare("INSERT INTO products(name,description,category,price,image,badge,stock) VALUES (?,?,?,?,?,?,?)").run(name,description,category,price,image,String(p.badge||"").slice(0,30),stock);
  res.status(201).json(db.prepare("SELECT * FROM products WHERE id=?").get(result.lastInsertRowid));
});
app.put("/api/admin/products/:id", auth, adminOnly, (req, res) => {
  const p=req.body||{}, id=Number(req.params.id), name=String(p.name||"").trim().slice(0,100), description=String(p.description||"").trim().slice(0,500), category=String(p.category||"General").trim().slice(0,40), image=String(p.image||"").trim().slice(0,500), price=Number(p.price), stock=Number(p.stock);
  if (!name || !Number.isInteger(price) || price<1 || !Number.isInteger(stock) || stock<0) return res.status(400).json({error:"Enter a product name, valid price and stock."});
  const result=db.prepare("UPDATE products SET name=?,description=?,category=?,price=?,image=?,badge=?,stock=? WHERE id=?").run(name,description,category,price,image,String(p.badge||"").slice(0,30),stock,id);
  if (!result.changes) return res.status(404).json({error:"Product not found."});
  res.json({message:"Product updated."});
});
app.delete("/api/admin/products/:id", auth, adminOnly, (req,res)=>{
  const id=Number(req.params.id);
  if (db.prepare("SELECT 1 FROM order_items WHERE product_id=?").get(id)) return res.status(400).json({error:"This product is in an order history; set its stock to 0 instead."});
  db.prepare("DELETE FROM wishlists WHERE product_id=?").run(id); db.prepare("DELETE FROM reviews WHERE product_id=?").run(id);
  const result=db.prepare("DELETE FROM products WHERE id=?").run(id);
  if(!result.changes) return res.status(404).json({error:"Product not found."}); res.json({message:"Product deleted."});
});
app.post("/api/auth/forgot-password", (req,res)=>res.json({message:"If an account exists for that email, reset instructions would be sent. Configure an email provider to enable delivery."}));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Shopora running on port ${PORT}`));
