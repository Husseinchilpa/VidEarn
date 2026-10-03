const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("videarn.db");
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_ME_IN_PRODUCTION";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "saadaamjilba@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME";

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:1000*60*60*8}
}));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 points INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 reward_points INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS withdrawals(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount_usd REAL NOT NULL,
 iban TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS point_ledger(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 points INTEGER NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const admin = db.prepare("SELECT id FROM users WHERE email=?").get(ADMIN_EMAIL);
if(!admin){
  const hash=bcrypt.hashSync(ADMIN_PASSWORD,12);
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
    .run("VidEarn Admin",ADMIN_EMAIL,hash,"admin");
}
if(db.prepare("SELECT COUNT(*) c FROM tasks").get().c===0){
  const ins=db.prepare("INSERT INTO tasks(title,description,reward_points) VALUES(?,?,?)");
  ins.run("Watch a video","Complete an approved video task.",25);
  ins.run("Daily check-in","Check in once every 24 hours.",10);
  ins.run("Quick task","Complete a short approved task.",50);
}

function auth(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"Login required"});
  next();
}
function adminOnly(req,res,next){
  if(!req.session.user || req.session.user.role!=="admin") return res.status(403).json({error:"Admin only"});
  next();
}

app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use(express.static(path.join(__dirname,"public")));

app.post("/api/register",(req,res)=>{
  const {name,email,password}=req.body;
  if(!name||!email||!password||password.length<8) return res.status(400).json({error:"Name, email and password (8+ chars) are required"});
  try{
    const hash=bcrypt.hashSync(password,12);
    const r=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name.trim(),email.trim().toLowerCase(),hash);
    req.session.user={id:r.lastInsertRowid,name:name.trim(),email:email.trim().toLowerCase(),role:"user"};
    res.json({ok:true,user:req.session.user});
  }catch(e){res.status(400).json({error:"Email already registered"});}
});

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE email=?").get((email||"").trim().toLowerCase());
  if(!u||!bcrypt.compareSync(password||"",u.password_hash)) return res.status(401).json({error:"Invalid email or password"});
  req.session.user={id:u.id,name:u.name,email:u.email,role:u.role};
  res.json({ok:true,user:req.session.user});
});

app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT id,name,email,role,points,created_at FROM users WHERE id=?").get(req.session.user.id);
  res.json(u);
});

app.get("/api/tasks",auth,(req,res)=>res.json(db.prepare("SELECT id,title,description,reward_points FROM tasks WHERE active=1 ORDER BY id").all()));

app.post("/api/tasks/:id/complete",auth,(req,res)=>{
  const task=db.prepare("SELECT * FROM tasks WHERE id=? AND active=1").get(req.params.id);
  if(!task) return res.status(404).json({error:"Task not found"});
  db.transaction(()=>{
    db.prepare("UPDATE users SET points=points+? WHERE id=?").run(task.reward_points,req.session.user.id);
    db.prepare("INSERT INTO point_ledger(user_id,points,reason) VALUES(?,?,?)").run(req.session.user.id,task.reward_points,`Completed task: ${task.title}`);
  })();
  res.json({ok:true,earned:task.reward_points});
});

app.post("/api/withdrawals",auth,(req,res)=>{
  const amount=Number(req.body.amount);
  const iban=String(req.body.iban||"").trim();
  if(!Number.isFinite(amount)||amount<5) return res.status(400).json({error:"Minimum withdrawal is $5"});
  if(!/^[A-Za-z0-9 ]{10,40}$/.test(iban)) return res.status(400).json({error:"Enter a valid bank/IBAN value"});
  const needed=Math.ceil(amount*1000);
  const u=db.prepare("SELECT points FROM users WHERE id=?").get(req.session.user.id);
  if(u.points<needed) return res.status(400).json({error:"Insufficient points"});
  db.transaction(()=>{
    db.prepare("UPDATE users SET points=points-? WHERE id=?").run(needed,req.session.user.id);
    db.prepare("INSERT INTO withdrawals(user_id,amount_usd,iban) VALUES(?,?,?)").run(req.session.user.id,amount,iban);
    db.prepare("INSERT INTO point_ledger(user_id,points,reason) VALUES(?,?,?)").run(req.session.user.id,-needed,`Withdrawal request: $${amount.toFixed(2)}`);
  })();
  res.json({ok:true,status:"pending"});
});

app.get("/api/admin/stats",adminOnly,(req,res)=>{
  res.json({
    users:db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c,
    tasks:db.prepare("SELECT COUNT(*) c FROM tasks WHERE active=1").get().c,
    pendingWithdrawals:db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c
  });
});
app.get("/api/admin/withdrawals",adminOnly,(req,res)=>{
  res.json(db.prepare(`SELECT w.id,w.amount_usd,w.iban,w.status,w.created_at,u.name,u.email
    FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC`).all());
});
app.post("/api/admin/withdrawals/:id/status",adminOnly,(req,res)=>{
  const allowed=["pending","approved","paid","rejected"];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:"Invalid status"});
  const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(req.params.id);
  if(!w) return res.status(404).json({error:"Withdrawal not found"});
  db.prepare("UPDATE withdrawals SET status=? WHERE id=?").run(req.body.status,w.id);
  if(req.body.status==="rejected" && w.status!=="rejected"){
    const needed=Math.ceil(w.amount_usd*1000);
    db.transaction(()=>{
      db.prepare("UPDATE users SET points=points+? WHERE id=?").run(needed,w.user_id);
      db.prepare("INSERT INTO point_ledger(user_id,points,reason) VALUES(?,?,?)").run(w.user_id,needed,"Refunded rejected withdrawal");
    })();
  }
  res.json({ok:true});
});

app.listen(PORT,()=>console.log(`VidEarn running on http://localhost:${PORT}`));
