# VidEarn backend

## What is included
- Node.js + Express server
- SQLite database (`videarn.db` is created automatically)
- Secure password hashing with bcrypt
- Session-based login
- User registration/login/logout
- Tasks and point ledger
- Withdrawal requests
- Admin dashboard
- Admin withdrawal status controls

## First setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set a long random SESSION_SECRET.
4. Set a strong ADMIN_PASSWORD.
5. Run `npm install`.
6. Run `npm start`.
7. Open `/` for users and `/admin.html` for admin.

Admin email is `saadaamjilba@gmail.com`.

## Production requirements
Before accepting real money:
- use HTTPS
- use a production session store (not MemoryStore)
- set secure cookies
- add CSRF protection and rate limiting
- validate and encrypt/protect sensitive bank data
- use a real payment/bank provider rather than manually moving money from the dashboard
- add task/ad provider integrations and server-side fraud prevention
- add Terms and Privacy Policy
- back up the database
