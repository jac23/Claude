// app.js
// UI controller: connects the audio engine + classifier to the DOM.

(function () {
  const { classifyBark } = window.BarkClassifier;

  const els = {
    toggle: document.getElementById('toggle-btn'),
    status: document.getElementById('status'),
    meterFill: document.getElementById('meter-fill'),
    result: document.getElementById('result'),
    resultIcon: document.getElementById('result-icon'),
    resultLabel: document.getElementById('result-label'),
    resultBlurb: document.getElementById('result-blurb'),
    resultPlay: document.getElementById('result-play'),
    resultDetail: document.getElementById('result-detail'),
    resultConfidence: document.getElementById('result-confidence'),
    resultTips: document.getElementById('result-tips'),
    features: document.getElementById('features'),
    history: document.getElementById('history'),
    historyEmpty: document.getElementById('history-empty'),
    clearHistory: document.getElementById('clear-history'),
    sensitivity: document.getElementById('sensitivity'),
  };

  let history = [];
  let currentAudioUrl = null;
  const player = new Audio();

  function playAudio(url) {
    if (!url) return;
    player.src = url;
    player.currentTime = 0;
    const p = player.play();
    if (p && p.catch) p.catch(() => {});
  }

  const engine = new window.AudioEngine({
    onLevel: (level) => {
      els.meterFill.style.width = Math.round(level * 100) + '%';
    },
    onEvent: (features) => handleBark(features),
  });

  function handleBark(features) {
    const { profile, confidence } = classifyBark(features);
    renderResult(profile, confidence, features);
    addToHistory(profile, confidence, features);
    pulse(profile.color);
  }

  function renderResult(profile, confidence, features) {
    els.result.hidden = false;
    els.result.style.setProperty('--accent', profile.color);
    els.resultIcon.textContent = profile.icon;
    els.resultLabel.textContent = profile.label;
    els.resultBlurb.textContent = profile.blurb;
    els.resultDetail.textContent = profile.detail;

    const pct = Math.round(confidence * 100);
    els.resultConfidence.textContent = pct + '% confidence';
    els.resultConfidence.style.setProperty('--pct', pct + '%');

    currentAudioUrl = features.audioUrl || null;
    els.resultPlay.hidden = !currentAudioUrl;

    els.resultTips.innerHTML = '';
    profile.tips.forEach((tip) => {
      const li = document.createElement('li');
      li.textContent = tip;
      els.resultTips.appendChild(li);
    });

    els.features.innerHTML = '';
    featureRows(features).forEach(([name, value]) => {
      const div = document.createElement('div');
      div.className = 'feature';
      div.innerHTML =
        '<span class="feature-name">' +
        name +
        '</span><span class="feature-value">' +
        value +
        '</span>';
      els.features.appendChild(div);
    });
  }

  function featureRows(f) {
    return [
      ['Pitch', Math.round(f.pitchHz) + ' Hz'],
      ['Loudness', Math.round(f.loudness * 100) + '%'],
      ['Duration', Math.round(f.durationMs) + ' ms'],
      ['Repetition', f.repetitionHz.toFixed(1) + '/s'],
      ['Tonality', Math.round(f.tonality * 100) + '%'],
    ];
  }

  function addToHistory(profile, confidence, features) {
    history.unshift({ profile, confidence, features });
    if (history.length > 25) {
      const dropped = history.pop();
      if (dropped.features.audioUrl) URL.revokeObjectURL(dropped.features.audioUrl);
    }
    renderHistory();
  }

  function renderHistory() {
    els.historyEmpty.hidden = history.length > 0;
    els.history.innerHTML = '';
    history.forEach((h, idx) => {
      const time = new Date(h.features.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const li = document.createElement('li');
      li.className = 'history-item';
      li.style.setProperty('--accent', h.profile.color);
      const playBtn = h.features.audioUrl
        ? '<button class="play-btn small" type="button" data-idx="' +
          idx +
          '" title="Replay this bark">▶︎</button>'
        : '';
      li.innerHTML =
        '<span class="history-icon">' +
        h.profile.icon +
        '</span>' +
        '<span class="history-main">' +
        '<span class="history-label">' +
        h.profile.label +
        '</span>' +
        '<span class="history-meta">' +
        Math.round(h.features.pitchHz) +
        ' Hz &middot; ' +
        Math.round(h.confidence * 100) +
        '%</span>' +
        '</span>' +
        playBtn +
        '<span class="history-time">' +
        time +
        '</span>';
      els.history.appendChild(li);
    });
  }

  function pulse(color) {
    document.body.style.setProperty('--pulse', color);
    document.body.classList.remove('barked');
    // Force reflow so the animation can restart.
    void document.body.offsetWidth;
    document.body.classList.add('barked');
  }

  async function startListening() {
    try {
      els.status.textContent = 'Requesting microphone…';
      await engine.start();
      applySensitivity();
      els.toggle.classList.add('listening');
      els.toggle.querySelector('.toggle-label').textContent = 'Stop listening';
      els.status.textContent = 'Listening… make some noise, pup!';
    } catch (err) {
      console.error(err);
      els.status.textContent =
        'Microphone access denied or unavailable. Check your browser ' +
        'permissions and that you are on HTTPS or localhost.';
    }
  }

  async function stopListening() {
    await engine.stop();
    els.toggle.classList.remove('listening');
    els.toggle.querySelector('.toggle-label').textContent = 'Start listening';
    els.status.textContent = 'Stopped. Tap to listen again.';
    els.meterFill.style.width = '0%';
  }

  function applySensitivity() {
    // Slider 0..100 -> lower means more sensitive (smaller threshold mul).
    const v = Number(els.sensitivity.value);
    // Map so mid (50) ~ default 3.0; high sensitivity ~ 1.8; low ~ 5.0.
    engine.openThresholdMul = 5.0 - (v / 100) * 3.2;
    engine.closeThresholdMul = engine.openThresholdMul * 0.6;
  }

  els.toggle.addEventListener('click', () => {
    if (engine.isRunning) stopListening();
    else startListening();
  });

  els.sensitivity.addEventListener('input', () => {
    if (engine.isRunning) applySensitivity();
  });

  els.resultPlay.addEventListener('click', () => playAudio(currentAudioUrl));

  els.history.addEventListener('click', (e) => {
    const btn = e.target.closest('.play-btn');
    if (!btn) return;
    const entry = history[Number(btn.dataset.idx)];
    if (entry) playAudio(entry.features.audioUrl);
  });

  els.clearHistory.addEventListener('click', () => {
    history.forEach((h) => {
      if (h.features.audioUrl) URL.revokeObjectURL(h.features.audioUrl);
    });
    history = [];
    currentAudioUrl = null;
    els.resultPlay.hidden = true;
    renderHistory();
  });

  // Feature-detect Web Audio + getUserMedia up front.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.status.textContent =
      'This browser does not support microphone capture. Try a recent ' +
      'Chrome, Safari, or Firefox.';
    els.toggle.disabled = true;
  }

  renderHistory();
})();
