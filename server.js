require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { nanoid } = require('nanoid');

const OWNER_PASS = process.env.OWNER_PASS || 'owner123';

// NEW: مشرفين متعددين من متغيّر بيئة JSON
let ADMINS = {};
try {
  // مثال القيمة: {"rami":"rami111","ali":"ali222"}
  ADMINS = JSON.parse(process.env.ADMIN_USERS || '{}');
} catch (e) {
  ADMINS = {};
}

// (اختياري) توافقاً مع القديم لو بدك كلمة موحدة للمشرفين
const ADMIN_PASS = process.env.ADMIN_PASS || null;

// دالة التحقق
function checkAuth(name, role, pass) {
  if (role === 'owner') return pass === OWNER_PASS;
  if (role === 'admin') {
    const expected = ADMINS[name] || ADMIN_PASS; // لو ما له كلمة خاصة، يرجع للقديمة إن وُجدت
    return !!expected && pass === expected;
  }
  // المستخدم العادي بلا كلمة
  return true;
}
