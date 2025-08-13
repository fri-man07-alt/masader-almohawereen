const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);

// تشغيل الملفات الثابتة (CSS, JS, صور...)
app.use(express.static(path.join(__dirname)));

// مسار الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// تشغيل الخادم على البورت
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
