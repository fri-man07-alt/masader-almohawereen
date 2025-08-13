// server.js
// خادم بسيط للدردشة + أدوار (مستخدم/مشرف/مالك) مع كلمات سر من متغيرات البيئة

require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// كلمات السر من متغيرات البيئة (مع قيم افتراضية)
const ABOADAM94 = process.env.OWNER_PASS || 'owner123';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// تخزين مؤقت داخل الذاكرة (بدون قاعدة بيانات)
const banned = new Set();        // المحظورين كلياً
const muted = new Set();         // الممنوعين من الكتابة
const onlineUsers = new Map();   // socket.id -> { name, role }

// صفحة الواجهة + الملفات الثابتة
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.use(express.static(__dirname));

// نقطة فحص سريعة للصحة
app.get('/health', (_req, res) => res.json({ ok: true }));

// لمعلومات الصفحة (تظهر تحت الفورم)
app.get('/defaults', (_req, res) => {
  res.json({
    ownerPassHint: OWNER_PASS ? 'مُحددة من متغير البيئة' : 'owner123',
    adminPassHint: ADMIN_PASS ? 'مُحددة من متغير البيئة' : 'admin123'
  });
});

// التحقق من الدور وكلمة السر
function checkCredentials(role, pass) {
  if (role === 'owner')  return pass === OWNER_PASS;
  if (role === 'admin')  return pass === ADMIN_PASS;
  if (role === 'user')   return true; // المستخدم لا يحتاج كلمة سر
  return false;
}

// أحداث Socket.IO
io.on('connection', (socket) => {
  // محاولة تسجيل الدخول
  socket.on('login', ({ name, role, pass }, cb) => {
    try {
      name = String(name || '').trim();
      role = String(role || 'user').trim();

      if (!name) return cb({ ok: false, error: 'يرجى إدخال اسم.' });
      if (banned.has(name)) return cb({ ok: false, error: 'هذا المستخدم محظور.' });
      if (!['user', 'admin', 'owner'].includes(role))
        return cb({ ok: false, error: 'دور غير صالح.' });

      if (!checkCredentials(role, pass))
        return cb({ ok: false, error: 'كلمة المرور غير صحيحة.' });

      onlineUsers.set(socket.id, { name, role });
      socket.data.user = { name, role };
      socket.join('global');

      io.to('global').emit('system', `${name} انضم إلى الدردشة (${role}).`);
      cb({ ok: true, me: { name, role } });
    } catch (e) {
      cb({ ok: false, error: 'خطأ غير متوقع.' });
    }
  });

  // إرسال رسالة
  socket.on('message', (text) => {
    const u = socket.data.user;
    if (!u) return;
    if (banned.has(u.name)) return;
    if (muted.has(u.name)) {
      socket.emit('system', 'لا يمكنك الإرسال حالياً (تم سحب الكتابة).');
      return;
    }
    text = String(text || '').trim();
    if (!text) return;
    io.to('global').emit('message', { from: u.name, role: u.role, text, ts: Date.now() });
  });

  // أوامر الإدارة
  function isPrivileged(u) { return u && (u.role === 'owner' || u.role === 'admin'); }
  function isOwner(u) { return u && u.role === 'owner'; }

  // حظر/فك حظر (مالك فقط)
  socket.on('ban', (target) => {
    const u = socket.data.user;
    if (!isOwner(u)) return;
    target = String(target || '').trim();
    if (!target) return;
    banned.add(target);
    muted.delete(target);
    io.to('global').emit('system', `تم حظر ${target} بواسطة ${u.name}.`);
  });

  socket.on('unban', (target) => {
    const u = socket.data.user;
    if (!isOwner(u)) return;
    target = String(target || '').trim();
    if (!target) return;
    banned.delete(target);
    io.to('global').emit('system', `تم فك حظر ${target} بواسطة ${u.name}.`);
  });

  // سحب/منح الكتابة (مالك أو مشرف)
  socket.on('revokeWrite', (target) => {
    const u = socket.data.user;
    if (!isPrivileged(u)) return;
    target = String(target || '').trim();
    if (!target) return;
    muted.add(target);
    io.to('global').emit('system', `تم سحب الكتابة من ${target} بواسطة ${u.name}.`);
  });

  socket.on('grantWrite', (target) => {
    const u = socket.data.user;
    if (!isPrivileged(u)) return;
    target = String(target || '').trim();
    if (!target) return;
    muted.delete(target);
    io.to('global').emit('system', `تم منح الكتابة لـ ${target} بواسطة ${u.name}.`);
  });

  socket.on('disconnect', () => {
    const u = socket.data.user;
    if (u) {
      io.to('global').emit('system', `${u.name} غادر الدردشة.`);
      onlineUsers.delete(socket.id);
    }
  });
});

// تشغيل على البورت المطلوب من Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
