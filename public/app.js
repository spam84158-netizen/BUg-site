const socket = io();

// ── Identifiant persistant du visiteur ──
function getUserId() {
  let id = localStorage.getItem('userId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'u-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    localStorage.setItem('userId', id);
  }
  return id;
}
const USER_ID = getUserId();
socket.emit('set-user', USER_ID);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

// ── Copie dans le presse-papiers + toast ──
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Badge Founder (devis prime) ──
function updateFounderBadge() {
  const name = (localStorage.getItem('userName') || '').toLowerCase().trim();
  const badge = document.getElementById('founder-badge');
  if (!badge) return;
  if (name === 'devis prime' || name === 'devisprime') badge.classList.remove('hidden');
  else badge.classList.add('hidden');
}

// ── IndexedDB : fond d'écran (photos + vidéos) ──
const wallpaperDB = {
  _dbp: null,
  open() {
    if (this._dbp) return this._dbp;
    this._dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('zainz-wallpaper', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbp;
  },
  async set(key, blob) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
};

function applyImageWallpaper(blob) {
  const bg = document.getElementById('bg-layer');
  bg.innerHTML = '';
  bg.classList.add('custom-bg');
  bg.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
}
function applyVideoWallpaper(blob) {
  const bg = document.getElementById('bg-layer');
  bg.style.backgroundImage = '';
  bg.classList.remove('custom-bg');
  const url = URL.createObjectURL(blob);
  bg.innerHTML = `<video class="custom-bg-video" src="${url}" autoplay loop playsinline></video>`;
}
async function restoreWallpaper() {
  const type = localStorage.getItem('wallpaperType');
  if (!type) return;
  const blob = await wallpaperDB.get('current').catch(() => null);
  if (!blob) return;
  if (type === 'image') applyImageWallpaper(blob);
  else if (type === 'video') applyVideoWallpaper(blob);
}
restoreWallpaper();

// ── ÉCRAN 1 : Canaux ──
const channelCards = document.querySelectorAll('.channel-card');
const joined = JSON.parse(localStorage.getItem('joinedChannels') || '{}');

function updateChannelUI() {
  let count = 0;
  channelCards.forEach(card => {
    const key = card.dataset.channel;
    if (joined[key]) { card.classList.add('joined'); count++; }
  });
  document.getElementById('progress-bar').style.width = (count / channelCards.length * 100) + '%';
  document.getElementById('progress-label').textContent = `${count}/${channelCards.length} canaux rejoints`;

  if (count === channelCards.length) {
    setTimeout(() => routeAfterChannels(), 400);
  }
}

async function routeAfterChannels() {
  if (!localStorage.getItem('accountCreated')) {
    showScreen('screen-signup');
    return;
  }
  const connected = await checkWaConnected();
  if (connected) { showScreen('screen-main'); renderMenu(); }
  else { showScreen('screen-connect'); }
}

async function checkWaConnected() {
  try {
    const res = await fetch(`/api/status?userId=${encodeURIComponent(USER_ID)}`);
    const data = await res.json();
    if (data.connected) localStorage.setItem('waNumber', data.number || '');
    return !!data.connected;
  } catch (e) { return false; }
}

channelCards.forEach(card => {
  card.addEventListener('click', () => {
    const key = card.dataset.channel;
    window.open(card.dataset.link, '_blank');
    joined[key] = true;
    localStorage.setItem('joinedChannels', JSON.stringify(joined));
    updateChannelUI();
  });
});
updateChannelUI();

// ── ÉCRAN 2 : Inscription ──
const avatarUpload = document.getElementById('avatar-upload');
const avatarInput = document.getElementById('avatar-input');
const avatarPreview = document.getElementById('avatar-preview');
let avatarDataUrl = '';

avatarUpload.addEventListener('click', () => avatarInput.click());
avatarInput.addEventListener('change', () => {
  const file = avatarInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    avatarDataUrl = e.target.result;
    avatarPreview.src = avatarDataUrl;
    avatarPreview.classList.add('has-image');
  };
  reader.readAsDataURL(file);
});

document.getElementById('toggle-password').addEventListener('click', () => {
  const input = document.getElementById('signup-password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-signup').addEventListener('click', () => {
  const name = document.getElementById('signup-name').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !password) { alert('Remplis tous les champs.'); return; }

  localStorage.setItem('accountCreated', '1');
  localStorage.setItem('userName', name);
  if (avatarDataUrl) localStorage.setItem('userAvatar', avatarDataUrl);

  updateFounderBadge();
  showScreen('screen-connect');
});

// ── ÉCRAN 2b : Connexion WhatsApp ──
const connectForm = document.getElementById('connect-form');
const connectWaiting = document.getElementById('connect-waiting');
const connectError = document.getElementById('connect-error');

document.getElementById('btn-connect').addEventListener('click', () => {
  const number = document.getElementById('connect-number').value.trim().replace(/[^0-9]/g, '');
  connectError.classList.add('hidden');
  if (number.length < 8) {
    connectError.textContent = 'Entre un numéro valide avec l\'indicatif.';
    connectError.classList.remove('hidden');
    return;
  }
  connectForm.classList.add('hidden');
  connectWaiting.classList.remove('hidden');
  document.getElementById('pairing-code-display').textContent = '••••••';
  document.getElementById('connect-status-label').textContent = 'Génération du code…';
  socket.emit('pair-request', { userId: USER_ID, number });
});

document.getElementById('connect-cancel').addEventListener('click', () => {
  connectWaiting.classList.add('hidden');
  connectForm.classList.remove('hidden');
});

// ── Code de pairage : copie auto + copie au clic ──
let currentPairingCode = '';

socket.on('pairing-code', async (code) => {
  currentPairingCode = code;
  document.getElementById('pairing-code-display').textContent = code;
  document.getElementById('connect-status-label').textContent = 'En attente de connexion…';

  const ok = await copyToClipboard(code);
  showToast(ok ? 'Code copié automatiquement ✓' : 'Touche le code pour le copier');
});

document.getElementById('pairing-code-display').addEventListener('click', async () => {
  if (!currentPairingCode) return;
  const ok = await copyToClipboard(currentPairingCode);
  showToast(ok ? 'Code copié ✓' : 'Copie impossible');
});

socket.on('pairing-error', (msg) => {
  connectWaiting.classList.add('hidden');
  connectForm.classList.remove('hidden');
  connectError.textContent = msg || 'Erreur de connexion, réessaie.';
  connectError.classList.remove('hidden');
});

socket.on('connection-status', (data) => {
  if (data.connected) {
    localStorage.setItem('waNumber', data.number || '');
    const label = document.getElementById('connect-status-label');
    if (label) label.textContent = 'Connecté ✓';
    const waValue = document.getElementById('wa-number-value');
    if (waValue) waValue.textContent = data.number ? '+' + data.number : '';

    const connectScreen = document.getElementById('screen-connect');
    if (connectScreen.classList.contains('active')) {
      setTimeout(() => { showScreen('screen-main'); renderMenu(); }, 600);
    }
  } else {
    localStorage.removeItem('waNumber');
    const waValue = document.getElementById('wa-number-value');
    if (waValue) waValue.textContent = '';
  }
});

// ── ÉCRAN 3 : Interface principale ──
let MENU = null;
let currentOption = null;

async function renderMenu() {
  const savedAvatar = localStorage.getItem('userAvatar');
  if (savedAvatar) document.getElementById('header-avatar').src = savedAvatar;
  else document.getElementById('header-avatar').src = 'assets/logo.png';

  updateFounderBadge();

  const waNumber = localStorage.getItem('waNumber');
  const waValue = document.getElementById('wa-number-value');
  if (waValue) waValue.textContent = waNumber ? '+' + waNumber : '';

  const res = await fetch('/api/menu');
  MENU = await res.json();

  const grid = document.getElementById('options-grid');
  grid.innerHTML = '';
  Object.entries(MENU).forEach(([key, opt]) => {
    const card = document.createElement('div');
    card.className = 'option-card facet';
    card.textContent = opt.label;
    card.addEventListener('click', () => openSubmenu(key));
    grid.appendChild(card);
  });
}

function openSubmenu(optionKey) {
  currentOption = optionKey;
  const opt = MENU[optionKey];
  document.getElementById('submenu-title').textContent = opt.label;
  const list = document.getElementById('submenu-list');
  list.innerHTML = '';
  Object.entries(opt.items).forEach(([subKey, label]) => {
    const item = document.createElement('div');
    item.className = 'submenu-item';
    item.dataset.sub = subKey;
    item.textContent = label;
    item.addEventListener('click', () => {
      document.getElementById('submenu-modal').classList.add('hidden');
      openSendScreen(optionKey, subKey, label);
    });
    list.appendChild(item);
  });
  document.getElementById('submenu-modal').classList.remove('hidden');
}
document.getElementById('submenu-close').addEventListener('click', () => {
  document.getElementById('submenu-modal').classList.add('hidden');
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(i => {
      i.classList.toggle('active', i.dataset.tab === tab);
    });
    if (tab === 'settings') showScreen('screen-settings');
    else showScreen('screen-main');
  });
});

// ── ÉCRAN 4 : Paramètres ──
document.getElementById('settings-back').addEventListener('click', () => showScreen('screen-main'));

document.getElementById('row-avatar').addEventListener('click', () => {
  document.getElementById('settings-avatar-input').click();
});
document.getElementById('settings-avatar-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    localStorage.setItem('userAvatar', ev.target.result);
    document.getElementById('header-avatar').src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('row-terms').addEventListener('click', () => {
  document.getElementById('terms-modal').classList.remove('hidden');
});
document.getElementById('terms-close').addEventListener('click', () => {
  document.getElementById('terms-modal').classList.add('hidden');
});

document.getElementById('row-wallpaper').addEventListener('click', () => {
  document.getElementById('wallpaper-modal').classList.remove('hidden');
});
document.getElementById('wallpaper-close').addEventListener('click', () => {
  document.getElementById('wallpaper-modal').classList.add('hidden');
});
document.getElementById('wallpaper-photo-btn').addEventListener('click', () => {
  document.getElementById('wallpaper-photo-input').click();
});
document.getElementById('wallpaper-video-btn').addEventListener('click', () => {
  document.getElementById('wallpaper-video-input').click();
});
document.getElementById('wallpaper-photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  applyImageWallpaper(file);
  localStorage.setItem('wallpaperType', 'image');
  await wallpaperDB.set('current', file);
});
document.getElementById('wallpaper-video-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  applyVideoWallpaper(file);
  localStorage.setItem('wallpaperType', 'video');
  await wallpaperDB.set('current', file);
});

document.getElementById('row-wa-number').addEventListener('click', () => {
  const number = localStorage.getItem('waNumber');
  if (!number) { showScreen('screen-connect'); return; }
  if (confirm(`Déconnecter le numéro +${number} ?`)) {
    socket.emit('logout', USER_ID);
    localStorage.removeItem('waNumber');
    document.getElementById('wa-number-value').textContent = '';
    document.getElementById('connect-form').classList.remove('hidden');
    document.getElementById('connect-waiting').classList.add('hidden');
    document.getElementById('connect-number').value = '';
    showScreen('screen-connect');
  }
});

document.getElementById('row-logout').addEventListener('click', () => {
  socket.emit('logout', USER_ID);
  wallpaperDB.clear().catch(() => {});
  localStorage.clear();
  location.reload();
});

// ── ÉCRAN 5 : Envoi ──
function openSendScreen(optionKey, subKey, label) {
  document.getElementById('send-title').textContent = label;
  document.getElementById('send-number').value = '';
  document.getElementById('send-error').classList.add('hidden');
  document.getElementById('send-success').classList.add('hidden');
  document.getElementById('send-progress-wrap').classList.add('hidden');
  document.getElementById('btn-send').dataset.option = optionKey;
  document.getElementById('btn-send').dataset.submenu = subKey;
  showScreen('screen-send');
}
document.getElementById('send-back').addEventListener('click', () => showScreen('screen-main'));

document.getElementById('btn-send').addEventListener('click', async () => {
  const number = document.getElementById('send-number').value.trim();
  const option = document.getElementById('btn-send').dataset.option;
  const submenu = document.getElementById('btn-send').dataset.submenu;

  document.getElementById('send-error').classList.add('hidden');
  document.getElementById('send-success').classList.add('hidden');
  if (!number) return;

  const progressWrap = document.getElementById('send-progress-wrap');
  const progressBar = document.getElementById('send-progress-bar');
  const progressLabel = document.getElementById('send-progress-label');
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = '0%';

  let pct = 0;
  const interval = setInterval(() => {
    pct = Math.min(pct + 5, 95);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = pct + '%';
  }, 80);

  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, option, submenu, number }),
    });
    const data = await res.json();
    clearInterval(interval);
    progressBar.style.width = '100%';
    progressLabel.textContent = '100%';

    if (data.ok) {
      document.getElementById('send-success').classList.remove('hidden');
    } else {
      document.getElementById('send-error').textContent = data.error || 'Numéro non valide.';
      document.getElementById('send-error').classList.remove('hidden');
    }
  } catch (err) {
    clearInterval(interval);
    document.getElementById('send-error').textContent = 'Erreur de connexion au serveur.';
    document.getElementById('send-error').classList.remove('hidden');
  }
});

// ── Restauration au chargement ──
if (localStorage.getItem('accountCreated')) {
  const savedAvatar = localStorage.getItem('userAvatar');
  if (savedAvatar) document.getElementById('header-avatar').src = savedAvatar;
  updateFounderBadge();
}
