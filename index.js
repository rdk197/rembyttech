import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

const app=express();
app.use(helmet());
app.use(cors({origin:process.env.CLIENT_ORIGIN||'http://localhost:5173'}));
app.use(express.json({limit:'1mb'}));
const db=new Database('rembyttech.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL,service TEXT,comment TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,status TEXT DEFAULT 'Новая');
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,type TEXT,condition TEXT,price TEXT,desc TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,message TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,answered INTEGER DEFAULT 0,reply TEXT);
`);
const safe=(s,max=500)=>String(s??'').trim().slice(0,max);
async function notify(text){
  if(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID){
    try{await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text})})}catch(e){console.error('Telegram notification failed',e.message)}
  }
  if(process.env.SMTP_HOST&&process.env.NOTIFY_EMAIL){
    try{const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});await transporter.sendMail({from:process.env.FROM_EMAIL||process.env.SMTP_USER,to:process.env.NOTIFY_EMAIL,subject:'Новое обращение — РемБытТех',text})}catch(e){console.error('Email notification failed',e.message)}
  }
}
function auth(req,res,next){try{const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'');req.user=jwt.verify(token,process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:'Требуется авторизация'})}}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'rembyttech-api'}));
app.get('/api/products',(req,res)=>res.json({products:db.prepare('SELECT * FROM products ORDER BY id DESC').all()}));
app.post('/api/orders',async(req,res)=>{
 const name=safe(req.body.name,100),phone=safe(req.body.phone,40),service=safe(req.body.service,120),comment=safe(req.body.comment,1000);
 if(!name||!phone)return res.status(400).json({error:'Укажите имя и телефон'});
 const info=db.prepare('INSERT INTO orders(name,phone,service,comment) VALUES(?,?,?,?)').run(name,phone,service,comment);
 await notify(`Новая заявка #${info.lastInsertRowid}\nИмя: ${name}\nТелефон: ${phone}\nУслуга: ${service}\nКомментарий: ${comment||'—'}`);
 res.status(201).json({ok:true,id:info.lastInsertRowid});
});
app.get('/api/chat/messages/:id',(req,res)=>{const m=db.prepare('SELECT id,message,reply,created_at FROM messages WHERE id=?').get(Number(req.params.id));if(!m)return res.status(404).json({error:'Диалог не найден'});res.json({message:m})});
app.post('/api/chat/messages',async(req,res)=>{
 const name=safe(req.body.name||'Посетитель сайта',100),message=safe(req.body.message,2000);
 if(!message)return res.status(400).json({error:'Введите сообщение'});
 const info=db.prepare('INSERT INTO messages(name,message) VALUES(?,?)').run(name,message);
 await notify(`Новое сообщение в чате #${info.lastInsertRowid}\n${name}: ${message}`);
 res.status(201).json({message:db.prepare('SELECT * FROM messages WHERE id=?').get(info.lastInsertRowid)});
});
app.post('/api/admin/login',(req,res)=>{
 if(!process.env.ADMIN_PASSWORD||!process.env.JWT_SECRET)return res.status(503).json({error:'Администратор не настроен. Заполните .env'});
 if(safe(req.body.password,200)!==process.env.ADMIN_PASSWORD)return res.status(401).json({error:'Неверный пароль'});
 res.json({token:jwt.sign({role:'admin'},process.env.JWT_SECRET,{expiresIn:'8h'})});
});
app.get('/api/admin/orders',auth,(req,res)=>res.json({orders:db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all()}));
app.get('/api/admin/messages',auth,(req,res)=>res.json({messages:db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all()}));
app.post('/api/admin/messages/:id/reply',auth,async(req,res)=>{const message=safe(req.body.message,2000);if(!message)return res.status(400).json({error:'Введите ответ'});const original=db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));if(!original)return res.status(404).json({error:'Сообщение не найдено'});db.prepare('UPDATE messages SET answered=1,reply=? WHERE id=?').run(message,Number(req.params.id));await notify(`Оператор ответил клиенту по диалогу #${original.id}: ${message}`);res.json({ok:true})});
app.post('/api/admin/products',auth,(req,res)=>{
 const p=req.body;if(!safe(p.name,150))return res.status(400).json({error:'Укажите название товара'});
 const info=db.prepare('INSERT INTO products(name,type,condition,price,desc) VALUES(?,?,?,?,?)').run(safe(p.name,150),safe(p.type,60),safe(p.condition,30),safe(p.price,60),safe(p.desc,1000));
 res.status(201).json({ok:true,id:info.lastInsertRowid});
});
app.delete('/api/admin/products/:id',auth,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id));res.json({ok:true})});
app.patch('/api/admin/orders/:id',auth,(req,res)=>{db.prepare('UPDATE orders SET status=? WHERE id=?').run(safe(req.body.status,40),Number(req.params.id));res.json({ok:true})});
const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`РемБытТех API: http://localhost:${port}`));
