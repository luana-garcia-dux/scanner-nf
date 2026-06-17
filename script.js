
  let currentUser = '';
  let pendingReadings = [];   // [{ value, format, time }]
  let sessionHistory = [];
  let detector = null;

  let popupCallback = null;

  function showPopup(type, message, onClose) {
    const popup = document.getElementById('popup');
    const box   = popup.querySelector('.popup-box');
    const icon  = popup.querySelector('.popup-icon');
    const msg   = popup.querySelector('.popup-msg');
    const icons = { success: '✓', error: '✕', info: 'i' };
  
    box.className = 'popup-box ' + type;
    icon.textContent = icons[type] || 'i';
    msg.textContent  = message;
    popupCallback = onClose || null;
    popup.classList.add('show');
  }
  
  function closePopup() {
    document.getElementById('popup').classList.remove('show');
    if (popupCallback) { const cb = popupCallback; popupCallback = null; cb(); }
  }

  function showLoading(message) {
    const el = document.getElementById('loading');
    el.querySelector('.loading-msg').textContent = message || 'Carregando...';
    el.classList.add('show');
  }
  
  function hideLoading() {
    document.getElementById('loading').classList.remove('show');
  }

  // ── Detector ──────────────────────────────────────────────────────────────
  async function initDetector() {
    if (!('BarcodeDetector' in window)) return;
    try {
      const formats = (await BarcodeDetector.getSupportedFormats())
        .filter(f => ['code_128', 'code_39'].includes(f));
      if (formats.length > 0) detector = new BarcodeDetector({ formats });
    } catch(e) {}
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
    input.multiple = !useCamera;   // galeria: várias de uma vez | câmera: uma por vez
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
        const value = barcodes[0].rawValue;
        const format = barcodes[0].format;

        if (pendingReadings.some(r => r.value === value)) {
          setStatus('Esse código já está na lista de pendentes', 'error');
        } else {
          const now = new Date();
          pendingReadings.push({
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
    } catch(e) {
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
      const badgeClass  = r.format === 'code_128' ? 'badge-128' : 'badge-39';
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
        <div class="meta">${h.user} · ${h.time}</div>
      </div>
    `).join('');
    document.getElementById('history-container').style.display = 'block';
  }

  // ── Confirmar envio de TODAS as pendentes ─────────────────────────────────
  function confirmAll() {
    if (!pendingReadings.length) return;

    pendingReadings.forEach(r => {
      const formatLabel = r.format === 'code_128' ? '128' : '39';
      const badgeClass = r.format === 'code_128' ? 'badge-128' : 'badge-39';
      sessionHistory.unshift({
        value: r.value, formatLabel, badgeClass, time: r.time, user: currentUser
      });
    });
    /*
    const url = 'https://exemplo.com';
    const body = pendingReadings;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
  
      if (!response.ok) {
        throw new Error(`Erro na requisição: ${response.status}`);
      }
  
      const result = await response.json();
  
      if (!result) { alert('Não foi possível salvar a(s) leitura(s). Entre em contato com o time interno da Dux Trucking.'); return; };
      console.log('Sucesso:', result);
      
    } catch (erro) {
      console.error('Falha ao comunicar com a API:', erro);
    }
    */
    const count = pendingReadings.length;
    pendingReadings = [];
    localStorage.removeItem('scanner-pending');
    localStorage.setItem('scanner-history', JSON.stringify(sessionHistory));

    renderPending();
    renderHistory();
    document.getElementById('preview-wrap').style.display = 'none';
    setStatus(`${count} código${count > 1 ? 's' : ''} salvo${count > 1 ? 's' : ''} no histórico!`, 'success');
  }

  // ── Carregamento inicial ──────────────────────────────────────────────────
  window.addEventListener('load', async () => {
    await initDetector();

    const savedUser = localStorage.getItem('scanner-user');
    if (savedUser) {
      currentUser = savedUser;
      document.getElementById('user-name-display').textContent = savedUser;
      document.getElementById('avatar-initials').textContent = getInitials(savedUser);
      document.getElementById('login-screen').classList.remove('active');
      document.getElementById('scanner-screen').classList.add('active');
      setStatus(detector ? 'Pronto para leitura' : 'BarcodeDetector não suportado — use Chrome Android', detector ? '' : 'error');

      const savedHistory = localStorage.getItem('scanner-history');
      if (savedHistory) {
        try { sessionHistory = JSON.parse(savedHistory); renderHistory(); } catch(e) { sessionHistory = []; }
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
        } catch(e) {
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
      const name = document.getElementById('login-name').value.trim();
      const pin = document.getElementById('password').value.trim();
      if (!name) { showPopup('error', 'Digite seu e-mail para entrar'); return; }
      if (!pin) { showPopup('error', 'Digite a senha para entrar.'); return; }
      
      const url = 'https://n8n-dux.duckdns.org/webhook-test/login-scan-nf';
      const body = {"email": name, "pin": pin};
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
  
      if (!response.ok) {        
        showPopup('error', `Erro no login: ${response.status}. Entre em contato com o time interno da Dux Trucking.`);
        throw new Error(`Erro na requisição: ${response.status}`);
        return;
      }
  
      const result = await response.json();
  
      if (!result.driver) {
        showPopup('error', 'Usuário ou senha inválida. Tente novamente.');
        return;
      }
      
      console.log('Sucesso:', result.message);
      pin.value = '';
      
      currentUser = result.driver;
      localStorage.setItem('scanner-user', currentUser);      
      document.getElementById('user-name-display').textContent = currentUser;
      document.getElementById('avatar-initials').textContent = getInitials(currentUser);
      document.getElementById('login-screen').classList.remove('active');
      document.getElementById('scanner-screen').classList.add('active');
      setStatus(detector ? 'Pronto para leitura' : 'BarcodeDetector não suportado — use Chrome Android', detector ? '' : 'error');
      
    } catch (erro) {
      console.error('Falha ao comunicar com a API:', erro);
      showPopup('error', 'Há algo errado. Entre em contato com o time interno da Dux Trucking.');
    } finally {
      hideLoading();
    }
  }

  function doLogout() {
    currentUser = '';
    sessionHistory = [];
    pendingReadings = [];
    localStorage.removeItem('scanner-user');
    localStorage.removeItem('scanner-history');
    localStorage.removeItem('scanner-pending');

    renderPending();
    document.getElementById('history-list').innerHTML = '';
    document.getElementById('history-container').style.display = 'none';
    document.getElementById('last-code').textContent = 'Nenhum código salvo ainda';
    document.getElementById('last-code').classList.add('empty');
    document.getElementById('last-meta').innerHTML = '';
    document.getElementById('login-name').value = '';
    document.getElementById('preview-wrap').style.display = 'none';
    document.getElementById('scanner-screen').classList.remove('active');
    document.getElementById('login-screen').classList.add('active');
  }
