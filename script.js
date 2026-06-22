let currentUser = '';
let currentUserName = '';
let pendingReadings = []; // [{ value, format, time }]
let sessionHistory = [];
let detector = null;

const LOGIN_URL = "https://n8n-dux.duckdns.org/webhook/login-scan-nf";
const LIST_URL = "https://n8n-dux.duckdns.org/webhook-test/insert-barcode";
const USERS_URL = "https://n8n-dux.duckdns.org/webhook/users"
const USER_URL = "https://n8n-dux.duckdns.org/webhook-test/user";

const MOCK_USERS = [
    { nome: 'João Silva', email: 'joao.silva@dux.com', permissao: 'admin' },
    { nome: 'Maria Oliveira', email: 'maria.oliveira@dux.com', permissao: 'user' }
];

let usersCache = [];
let newUser = true; // flag para diferenciar criação de edição no formulário de usuário

let popupCallback = null;

function showPopup(type, message, onClose) {
    const popup = document.getElementById('popup');
    const box = popup.querySelector('.popup-box');
    const icon = popup.querySelector('.popup-icon');
    const msg = popup.querySelector('.popup-msg');
    const icons = {
        success: '✓',
        error: '✕',
        info: 'i'
    };

    box.className = 'popup-box ' + type;
    icon.textContent = icons[type] || 'i';
    msg.textContent = message;
    popupCallback = onClose || null;
    popup.classList.add('show');
}

function closePopup() {
    document.getElementById('popup').classList.remove('show');
    if (popupCallback) {
        const cb = popupCallback;
        popupCallback = null;
        cb();
    }
}

function showLoading(message) {
    const el = document.getElementById('loading');
    el.querySelector('.loading-msg').textContent = message || 'Carregando...';
    el.classList.add('show');
}

function hideLoading() {
    document.getElementById('loading').classList.remove('show');
}

// ── Carregamento inicial ──────────────────────────────────────────────────
window.addEventListener('load', async () => {
    await initDetector();

    const savedUser = localStorage.getItem('scanner-user');
    if (savedUser) {
        currentUser = savedUser;
        const savedPage = localStorage.getItem('scanner-page') || 'scanner-screen';
        document.getElementById('heading-display').textContent = savedUser;
        document.getElementById('avatar-initials').textContent = getInitials(savedUser);
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById(savedPage).classList.add('active');

        if (savedPage === 'admin-screen') {
            loadUsers();
        }

        setStatus(detector ? 'Pronto para leitura' : 'BarcodeDetector não suportado — use Chrome Android', detector ? '' : 'error');

        const savedHistory = localStorage.getItem('scanner-history');
        if (savedHistory) {
            try {
                sessionHistory = JSON.parse(savedHistory);
                renderHistory();
            } catch (e) {
                sessionHistory = [];
            }
        }

        const savedPending = localStorage.getItem('scanner-pending');
        if (savedPending) {
            try {
                pendingReadings = JSON.parse(savedPending);
                // Descarta formato antigo (pré-lote) para não quebrar
                if (!Array.isArray(pendingReadings) ||
                    (pendingReadings.length && typeof pendingReadings[0] !== 'object')) {
                    pendingReadings = [];
                    localStorage.removeItem('scanner-pending');
                }
            } catch (e) {
                pendingReadings = [];
            }
            renderPending();
            if (pendingReadings.length) {
                setStatus(`${pendingReadings.length} leitura(s) pendente(s) — confirme o envio`, 'success');
            }
        }
    }
});

// ── Login / Logout ────────────────────────────────────────────────────────
async function doLogin() {
    showLoading('Carregando...');

    try {
        var page = 'scanner-screen';
        const name = document.getElementById('login-name').value.trim();
        const pin = document.getElementById('password').value.trim();
        if (!name) {
            showPopup('error', 'Digite seu e-mail para entrar');
            return;
        }
        if (!pin) {
            showPopup('error', 'Digite a senha para entrar.');
            return;
        }

        const body = {
            "email": name,
            "pin": pin
        };

        const response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            showPopup('error', `Erro no login: ${response.status}. Entre em contato com o time interno da Dux Trucking.`);
            return;
        }

        const result = await response.json();

        if (!result.user) {
            showPopup('error', 'Usuário ou senha inválida. Tente novamente.');
            return;
        }

        console.log('Sucesso:', result.message);

        if (result.permission == "admin") {
            page = 'admin-screen';
            loadUsers();
        }

        currentUser = result.id;
        currentUserName = result.user;
        localStorage.setItem('scanner-user', currentUser);
        localStorage.setItem('scanner-page', page);
        document.getElementById('heading-display').textContent = currentUserName;
        document.getElementById('avatar-initials').textContent = getInitials(currentUserName);
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById(page).classList.add('active');
        document.getElementById('password').value = '';
        setStatus(detector ? 'Pronto para leitura' : 'BarcodeDetector não suportado — use Chrome Android', detector ? '' : 'error');

    } catch (e) {
        console.error('Falha ao comunicar com a API:', e);
        showPopup('error', 'Há algo errado. Entre em contato com o time interno da Dux Trucking.');
    } finally {
        hideLoading();
    }
}

function doLogout() {
    currentUser = '';
    currentUserName = '';
    sessionHistory = [];
    pendingReadings = [];
    localStorage.removeItem('scanner-user');
    localStorage.removeItem('scanner-history');
    localStorage.removeItem('scanner-pending');
    localStorage.removeItem('scanner-page');

    renderPending();
    document.getElementById('history-list').innerHTML = '';
    document.getElementById('history-container').style.display = 'none';
    document.getElementById('last-code').textContent = 'Nenhum código salvo ainda';
    document.getElementById('last-code').classList.add('empty');
    document.getElementById('last-meta').innerHTML = '';
    document.getElementById('login-name').value = '';
    document.getElementById('preview-wrap').style.display = 'none';

    ['scanner-screen', 'admin-screen', 'login-screen'].forEach(id => document.getElementById(id).classList.remove('active'));
    document.getElementById('login-screen').classList.add('active');
}

// ── Detector ──────────────────────────────────────────────────────────────
async function initDetector() {
    if (!('BarcodeDetector' in window)) return;
    try {
        const formats = (await BarcodeDetector.getSupportedFormats())
            .filter(f => ['code_128', 'code_39'].includes(f));
        if (formats.length > 0) detector = new BarcodeDetector({
            formats
        });
    } catch (e) { }
}

// ── Input dinâmico — criado do zero a cada clique ─────────────────────────
function triggerInput(useCamera) {
    const old = document.getElementById('_dyn_input');
    if (old) old.remove();

    const input = document.createElement('input');
    input.type = 'file';
    input.id = '_dyn_input';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.multiple = !useCamera; // galeria: várias de uma vez | câmera: uma por vez
    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';

    input.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        input.remove();
        for (const file of files) await processBlob(file);
    });

    document.body.appendChild(input);
    input.click();
}

// ── Processamento de imagem → adiciona à lista de pendentes ───────────────
async function processBlob(blob) {
    if (!detector) {
        setStatus('BarcodeDetector não suportado — use Chrome Android', 'error');
        return;
    }

    const url = URL.createObjectURL(blob);
    const previewWrap = document.getElementById('preview-wrap');
    const previewImg = document.getElementById('preview-img');
    const overlay = document.getElementById('processing-overlay');

    previewImg.src = url;
    previewWrap.style.display = 'block';
    overlay.style.display = 'flex';
    document.getElementById('overlay-text').textContent = 'Lendo código...';
    setStatus('Analisando imagem...', 'loading');

    try {
        const bitmap = await createImageBitmap(blob);
        const barcodes = await detector.detect(bitmap);
        overlay.style.display = 'none';

        if (barcodes.length > 0) {
            const userid = currentUser;
            const username = currentUserName;
            const value = barcodes[0].rawValue;
            const format = barcodes[0].format;

            if (pendingReadings.some(r => r.value === value)) {
                setStatus('Esse código já está na lista de pendentes', 'error');
            } else {
                const now = new Date();
                pendingReadings.push({
                    userid,
                    username,
                    value,
                    format,
                    time: `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}`
                });
                savePending();
                renderPending();
                setStatus(`Código lido — ${pendingReadings.length} pendente${pendingReadings.length > 1 ? 's' : ''}`, 'success');
            }
        } else {
            setStatus('Nenhum código identificado — tente mais perto', 'error');
        }
    } catch (e) {
        overlay.style.display = 'none';
        setStatus('Erro ao processar imagem', 'error');
    }

    URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function getInitials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function setStatus(msg, type) {
    const el = document.getElementById('status-bar');
    el.textContent = msg;
    el.className = 'status-bar' + (type ? ' ' + type : '');
}

function savePending() {
    localStorage.setItem('scanner-pending', JSON.stringify(pendingReadings));
}

// ── Lista de pendentes ────────────────────────────────────────────────────
function renderPending() {
    const container = document.getElementById('pending-container');
    const list = document.getElementById('pending-list');
    const btn = document.getElementById('btn-confirmar');

    if (!pendingReadings.length) {
        container.style.display = 'none';
        list.innerHTML = '';
        btn.style.display = 'none';
        return;
    }

    document.getElementById('pending-count').textContent = pendingReadings.length;
    list.innerHTML = pendingReadings.map((r, i) => {
        const formatLabel = r.format === 'code_128' ? '128' : '39';
        const badgeClass = r.format === 'code_128' ? 'badge-128' : 'badge-39';
        return `
        <div class="pending-item">
          <div class="code"><span>${r.value}</span><span class="badge ${badgeClass}">Code ${formatLabel}</span></div>
          <button class="btn-remove" onclick="removePending(${i})" title="Remover">&times;</button>
        </div>`;
    }).join('');

    btn.textContent = `✓ Confirmar envio (${pendingReadings.length})`;
    btn.style.display = 'block';
    container.style.display = 'block';
}

function removePending(i) {
    pendingReadings.splice(i, 1);
    savePending();
    renderPending();
    setStatus(pendingReadings.length ? 'Item removido' : 'Lista de pendentes vazia', '');
}

// ── Histórico ─────────────────────────────────────────────────────────────
function renderHistory() {
    if (!sessionHistory.length) return;
    const last = sessionHistory[0];
    document.getElementById('last-code').textContent = last.value;
    document.getElementById('last-code').classList.remove('empty');
    document.getElementById('last-meta').innerHTML =
        `<span class="badge ${last.badgeClass}">Code ${last.formatLabel}</span> ${last.time}`;
    document.getElementById('history-list').innerHTML = sessionHistory.slice(0, 20).map(h => `
      <div class="history-item">
        <div class="code"><span>${h.value}</span><span class="badge ${h.badgeClass}">Code ${h.formatLabel}</span></div>
        <div class="meta">${h.currentUserName} · ${h.time}</div>
      </div>
    `).join('');
    document.getElementById('history-container').style.display = 'block';
}

// ── Confirmar envio de TODAS as pendentes ─────────────────────────────────
async function confirmAll() {
    if (!pendingReadings.length) return;

    const body = pendingReadings;

    try {
        const response = await fetch(LIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            setStatus('Não foi possível salvar — tente novamente', 'error');
            return;
        }

        await response.json();

    } catch (erro) {
        console.error('Falha ao comunicar com a API:', erro);
        setStatus('Sem conexão — leituras mantidas, tente de novo', 'error');
        return;
    }

    pendingReadings.forEach(r => {
        const formatLabel = r.format === 'code_128' ? '128' : '39';
        const badgeClass = r.format === 'code_128' ? 'badge-128' : 'badge-39';
        sessionHistory.unshift({
            value: r.value, formatLabel, badgeClass,
            time: r.time, user: currentUserName, id: currentUser
        });
    });

    const count = pendingReadings.length;
    pendingReadings = [];
    localStorage.removeItem('scanner-pending');
    localStorage.setItem('scanner-history', JSON.stringify(sessionHistory));

    renderPending();
    renderHistory();
    document.getElementById('preview-wrap').style.display = 'none';
    setStatus(`${count} código${count > 1 ? 's' : ''} salvo${count > 1 ? 's' : ''} no histórico!`, 'success');
}

function openUserForm() {
    newUser = true; // modo criação
    document.getElementById('f-nome').value = '';
    document.getElementById('f-email').value = '';
    document.getElementById('f-permissao').value = '';
    document.getElementById('user-form-modal').classList.add('show');
}

function closeUserForm() {
    document.getElementById('user-form-modal').classList.remove('show');
    newUser = true; // resetar flag ao fechar o formulário
}

async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';

    try {
        const response = await fetch(USERS_URL);

        if (!response.ok) {
            showPopup('error', `Erro no login: ${response.status}. Entre em contato com o time interno da Dux Trucking.`);
            return;
        }

        const users = await response.json();
        renderUsers(users);
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4">Erro ao carregar usuários.</td></tr>';
        showPopup('error', 'Não foi possível carregar os usuários.');
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('users-tbody');
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">Nenhum usuário cadastrado.</td></tr>';
        return;
    }

    function capitalizeWords(str) {
        return str.replace(/\b\w/g, c => c.toUpperCase());
    }

    usersCache = users;

    tbody.innerHTML = users.map((u, i) => `
        <tr>
            <td>${u.username ?? ''}</td>
            <td>${u.email ?? ''}</td>
            <td>${capitalizeWords(u.permission ?? '')}</td>
            <td><button class="btn-tb-actions" onclick="editUser(${i})">✏️</button></td>
        </tr>
    `).join('');
}

function editUser(index) {
    const user = usersCache[index];
    if (!user) return;

    newUser = false; // modo edição

    document.getElementById('f-nome').value = user.username ?? '';
    document.getElementById('f-email').value = user.email ?? '';
    document.getElementById('f-permissao').value = user.permission ?? '';
    document.getElementById('user-form-modal').classList.add('show');
}

async function saveUser() {
    const name = document.getElementById('f-nome').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const type = document.getElementById('f-permissao').value.trim();

    if (!name || !email || !type) {
        showPopup('error', 'Preencha todos os campos obrigatórios');
        return;
    }

    showLoading('Salvando...');

    try {
        const body = {
            "name": name,
            "email": email,
            "permission": type,
            "new": newUser
        };

        const response = await fetch(USER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            showPopup('error', `Erro: ${response.status}. Entre em contato com o time interno da Dux Trucking.`);
            return;
        }

        const result = await response.json();

        if (result.duplicated && newUser) {
            showPopup('error', `Usuário já cadastrado.`);
            return;
        }

        showPopup('success', newUser ? 'Usuário cadastrado!' : 'Usuário atualizado!');
        await loadUsers();
        closeUserForm();
    } catch (e) {
        showPopup('error', 'Erro ao salvar usuário.');
    } finally {
        hideLoading();
    }
}
