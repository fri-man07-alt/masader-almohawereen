const socket = io();

let ME = null;
let allowed = [];
const $ = s => document.querySelector(s);

const usersEl = $('#users');
const messagesEl = $('#messages');

function setBodyRole(){
  document.body.classList.toggle('owner', ME?.role==='owner');
}

// رابط قابل للنقر
function linkify(text){
  const urlRegex = /https?:\/\/[^\s]+/g;
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function addMsg(m){
  const box = messagesEl;
  const el = document.createElement('div'); el.className = 'msg'+(m.role==='system'?' sys':'');
  const nameCls = m.role==='owner'?'owner':(m.role==='admin'?'admin':'user');
  const icon = m.role==='owner'?'👑':(m.role==='admin'?'⭐':'👤');
  const meta = document.createElement('div'); meta.className='meta';
  meta.innerHTML = `<span class="name ${nameCls}">${icon} ${m.role==='system'?'النظام':m.sender}</span> · ${new Date(m.ts||Date.now()).toLocaleTimeString()}`;
  el.appendChild(meta);
  const media = document.createElement('div'); media.className='media';

  if (m.text){
    const p = document.createElement('div');
    p.innerHTML = linkify(m.text);
    el.appendChild(p);
  }
  if (m.fileUrl){
    const ext = (m.fileUrl.split('.').pop()||'').toLowerCase();
    if(['png','jpg','jpeg','webp','gif'].includes(ext)){
      const img = document.createElement('img'); img.src = m.fileUrl; media.appendChild(img);
    } else if(['mp4','webm','ogg','mov','m4v'].includes(ext)){
      const vid = document.createElement('video'); vid.controls = true; vid.src = m.fileUrl; media.appendChild(vid);
    } else if(['mp3','wav','ogg','webm'].includes(ext)){
      const au = document.createElement('audio'); au.controls = true; au.src = m.fileUrl; media.appendChild(au);
    } else {
      const a = document.createElement('a'); a.href = m.fileUrl; a.target='_blank'; a.textContent='📎 تنزيل ملف'; media.appendChild(a);
    }
    el.appendChild(media);
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// تسجيل الدخول
$('#loginBtn').onclick = async () => {
  const role = $('#role').value;
  const username = $('#name').value.trim();
  const pass = $('#pass').value;
  socket.emit('login', { username, role, pass });
};

socket.on('loginResult', ({ok,error,me,allowed:aw}) => {
  if(!ok){ $('#err').textContent = error||'فشل الدخول'; return; }
  ME = me; allowed = aw||[]; setBodyRole();
  $('#login').classList.add('hidden');
  $('.chat').classList.remove('hidden');
});

// قائمة المستخدمين
socket.on('users', list => {
  usersEl.innerHTML = '';
  list.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="role-${u.role}">${u.username}</span> ${u.canSpeak?'':'— 🛑 ممنوع من الكتابة'}`;
    usersEl.appendChild(li);
  });
});

socket.on('receiveMessage', addMsg);
socket.on('youCanSpeak', v => {
  if (ME) ME.canSpeak = !!v;
});

// إرسال نص
$('#send').onclick = () => {
  const t = $('#text').value.trim(); if(!t) return;
  if(!(ME.role==='owner'||ME.role==='admin'||ME.canSpeak)){
    addMsg({ sender:'النظام', role:'system', text:'❌ غير مسموح لك بالكتابة حالياً', ts:Date.now() }); return;
  }
  socket.emit('sendMessage', t);
  $('#text').value='';
};

// رفع ملفات
$('#file').addEventListener('change', async (e)=>{
  const files = [...e.target.files];
  for (const f of files){
    const fd = new FormData();
    fd.append('file', f);
    const r = await fetch('/api/upload-file',{ method:'POST', body:fd });
    const j = await r.json();
    if(j.ok){
      let kind = 'file';
      const ext = (j.url.split('.').pop()||'').toLowerCase();
      if(['png','jpg','jpeg','webp','gif'].includes(ext)) kind='image';
      else if(['mp3','wav','ogg','webm'].includes(ext)) kind='audio';
      else if(['mp4','webm','ogg','mov','m4v'].includes(ext)) kind='video';
      socket.emit('broadcastMedia', { url: j.url, kind });
    }
  }
  e.target.value = '';
});

// تسجيل صوتي
let mediaRecorder, chunks=[];
$('#recBtn').onclick = async ()=>{
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
    mediaRecorder.onstop = async ()=>{
      const blob = new Blob(chunks,{ type:'audio/webm' });
      const file = new File([blob],'voice.webm',{ type:'audio/webm' });
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/upload-file',{ method:'POST', body:fd });
      const j = await r.json();
      if(j.ok){ socket.emit('broadcastMedia',{ url: j.url, kind:'audio' }); }
    };
    mediaRecorder.start();
    $('#recBtn').disabled = true; $('#stopBtn').disabled=false;
  }catch(e){ alert('الميكروفون غير متاح'); }
};
$('#stopBtn').onclick = ()=>{
  if(mediaRecorder && mediaRecorder.state!=='inactive'){
    mediaRecorder.stop();
    $('#recBtn').disabled=false; $('#stopBtn').disabled=true;
  }
};

// أدوات الإدارة
$('#grant').onclick = ()=>{ const t = $('#target').value.trim(); if(!t) return; socket.emit('grant', t); $('#target').value=''; };
$('#revoke').onclick= ()=>{ const t = $('#target').value.trim(); if(!t) return; socket.emit('revoke', t); $('#target').value=''; };
$('#ban').onclick   = ()=>{ const t = $('#target').value.trim(); if(!t) return; socket.emit('ban', t); $('#target').value=''; };
$('#unban').onclick = ()=>{ const t = $('#target').value.trim(); if(!t) return; socket.emit('unban', t); $('#target').value=''; };
