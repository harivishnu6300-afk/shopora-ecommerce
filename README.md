# Shopora Ecommerce

Node.js + Express + SQLite ecommerce starter.

## Run locally

1. Install Node.js 22 LTS (recommended) or a supported Node.js release.
2. In this folder run:
   ```powershell
   npm install
   Copy-Item .env.example .env
   npm start
   ```
3. Open http://localhost:3000.

Set a long random `JWT_SECRET` in `.env`. Set `ADMIN_EMAIL` to the email address you register with to enable product management for that account.

## Checkout and orders

Checkout requires a delivery address, contact phone number, and a payment method. Cash on Delivery can place an order. The UPI option only checks that a transaction reference is entered; it does **not** verify a payment. Credit/debit card checkout is disabled until a real payment gateway is configured. Never collect raw card numbers/CVV in this demo.

Orders reduce stock inside a SQLite transaction. Customers can cancel an order while its status is `Placed`; cancellation is atomic, changes the status to `Cancelled`, and restores each ordered quantity to product stock exactly once.

## Hosting

Use persistent storage for the SQLite database (`DATA_DIR`) or accounts, orders, and stock may be lost when the hosting instance is replaced. Configure HTTPS, a strong `JWT_SECRET`, backups, email delivery for password reset, and a payment gateway before public production use.
