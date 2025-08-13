// خادم دردشة عربي — بدون قاعدة بيانات (يحفظ الملفات على القرص فقط)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { nanoid } = require('nanoid');

const OWNER_PASS = process.env.OWNER_PASS || 'owner123';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تقديم الواجهة وملفات الرفع
app.use('/uploads', express.static(path.join(__dirname,'uploads')));
app.use(express.static(path.join(__dirname,'public')));

// إعداد الرفع (يحفظ الملف داخل مجلد uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname,'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname||'').toLowerCase();
    cb(null, nanoid() + ext);
  }
});
const upload = multer({ storage });

// REST: رفع ملف واحد (صورة/صوت/فيديو/أي)
app.post('/api/upload-file', upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({ok:false,message:'لا يوجد ملف'});
  const url = '/uploads/' + req.file.filename;
  res.json({ ok:true, url });
});

// Socket.IO
const server = http.createServer(app);
const io = new Server(server, { cors: { origin:'*' } });

// حالة مؤقتة بالذاكرة
const users = new Map();     // socket.id -> { username, role, canSpeak }
const byName = new Map();    // username -> socket.id
const allowed = new Set();   // أسماء المستخدمين المسموح لهم بالكتابة (عدا الطاقم)
const banned  = new Set();   // محظورون

const clean = s => String(s||'').trim().slice(0,30).replace(/[<>]/g,'');
const isStaff = r => r==='owner' || r==='admin';
function sys(text){ io.emit('receiveMessage',{ sender:'النظام', role:'system', text, ts:Date.now() }); }
function linkKind(url){
  const u = (url||'').toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(u)) return 'image';
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(u)) return 'video';
  if (/\.(mp3|wav|ogg|webm)$/.test(u)) return 'audio';
  return 'file';
}

io.on('connection', socket => {
  // تسجيل الدخول
  socket.on('login', ({ username, role, pass })=>{
    username = clean(username);
    role = role || 'user';
    if(!username) return socket.emit('loginResult',{ok:false,error:'اكتب اسم المستخدم'});
    if(banned.has(username)) return socket.emit('loginResult',{ok:false,error:'هذا المستخدم محظور'});
    if(byName.has(username)) return socket.emit('loginResult',{ok:false,error:'الاسم مستخدم حالياً'});

    if(role==='owner' && pass!==OWNER_PASS) return socket.emit('loginResult',{ok:false,error:'كلمة مرور المالك غير صحيحة'});
    if(role==='admin' && pass!==ADMIN_PASS) return socket.emit('loginResult',{ok:false,error:'كلمة مرور المشرف غير صحيحة'});
    if(!['owner','admin','user'].includes(role)) role='user';

    const canSpeak = isStaff(role) || allowed.has(username);
    users.set(socket.id, { username, role, canSpeak });
    byName.set(username, socket.id);

    socket.emit('loginResult',{ ok:true, me:{ username, role, canSpeak }, allowed:Array.from(allowed) });
    io.emit('users', Array.from(users.values()));

    // تنبيه دخول خاص للمالك/المشرف
    if (isStaff(role)) {
      sys(`⚠️ ${username} (${role==='owner'?'المالك':'مشرف'}) دخل الغرفة!`);
    } else {
      sys(`👋 ${username} دخل الغرفة.`);
    }
  });

  // نص
  socket.on('sendMessage', (text)=>{
    const u = users.get(socket.id);
    if(!u) return;
    if(banned.has(u.username)) return;
    if(!(u.canSpeak || isStaff(u.role))) {
      return socket.emit('receiveMessage',{ sender:'النظام', role:'system', text:'❌ غير مسموح لك بالكتابة حالياً', ts:Date.now() });
    }
    text = clean(String(text||''));
    if(!text) return;
    io.emit('receiveMessage',{ sender:u.username, role:u.role, text, ts:Date.now() });
  });

  // بث ملف/رابط (بعد REST upload أو مباشرة كرابط)
  socket.on('broadcastMedia', ({ url, kind })=>{
    const u = users.get(socket.id);
    if(!u) return;
    if(!(u.canSpeak || isStaff(u.role))) return;
    url = String(url||'').trim();
    if(!url) return;
    kind = kind || linkKind(url);
    io.emit('receiveMessage',{ sender:u.username, role:u.role, fileUrl:url, kind, ts:Date.now() });
  });

  // أوامر الإدارة
  socket.on('grant', (target)=>{
    const me = users.get(socket.id); if(!me || !isStaff(me.role)) return;
    target = clean(target); if(!target) return;
    allowed.add(target);
    // فعّل فوراً لو متصل
    const sid = byName.get(target);
    if (sid && users.has(sid)) { const u = users.get(sid); u.canSpeak = true; users.set(sid,u); io.to(sid).emit('youCanSpeak', true); }
    io.emit('users', Array.from(users.values()));
    sys(`✍️ تم منح ${target} صلاحية الكتابة`);
  });

  socket.on('revoke', (target)=>{
    const me = users.get(socket.id); if(!me || !isStaff(me.role)) return;
    target = clean(target); if(!target) return;
    allowed.delete(target);
    const sid = byName.get(target);
    if (sid && users.has(sid)) { const u = users.get(sid); if(!isStaff(u.role)) { u.canSpeak = false; users.set(sid,u); io.to(sid).emit('youCanSpeak', false); } }
    io.emit('users', Array.from(users.values()));
    sys(`🛑 تم سحب صلاحية الكتابة من ${target}`);
  });

  socket.on('ban', (target)=>{
    const me = users.get(socket.id); if(!me || !isStaff(me.role)) return;
    target = clean(target); if(!target) return;
    banned.add(target);
    const sid = byName.get(target);
    if(sid){ io.to(sid).disconnectSockets(true); users.delete(sid); byName.delete(target); }
    sys(`🚫 تم حظر ${target}`);
    io.emit('users', Array.from(users.values()));
  });

  socket.on('unban', (target)=>{
    const me = users.get(socket.id); if(!me || me.role!=='owner') return; // المالك فقط
    target = clean(target); if(!target) return;
    banned.delete(target);
    sys(`✅ تم فك الحظر عن ${target}`);
  });

  socket.on('disconnect', ()=>{
    const u = users.get(socket.id);
    if(u){
      users.delete(socket.id);
      byName.delete(u.username);
      sys(`🚪 ${u.username} غادر الغرفة`);
      io.emit('users', Array.from(users.values()));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('🚀 Nord Lite Chat listening on', PORT));
