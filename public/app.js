// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  tracks: [],
  selected: new Set(),
  clientId: null,
  ws: null,
  jobs: {},
  activeProcessingCount: 0, // Footprint monitor to prevent multiple spammed execution calls
  settings: {
    quality: '192', // FIX: Updated baseline environment footprint configuration property initialization
    speed: 1.0,
    pitch: 0,
    normalize: false
  }
};

// ─── DOM Elements Mapping hooks definitions ──────────────────────────────────
const $ = id => document.getElementById(id);
const urlInput = $('urlInput');
const urlWrap = urlInput.closest('.url-input-wrap');
const clearBtn = $('clearBtn');
const fetchBtn = $('fetchBtn');
const trackCard = $('trackCard');
const trackList = $('trackList');
const trackCount = $('trackCount');
const trackListLabel = $('trackListLabel');
const selectAllBtn = $('selectAllBtn');
const deselectAllBtn = $('deselectAllBtn');
const convertBtn = $('convertBtn');
const jobsSection = $('jobsSection');
const jobsList = $('jobsList');
const normalizeToggle = $('normalizeToggle');

// ─── WebSocket Engine pipeline management hooks loop ──────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  state.ws = ws;

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'connected') {
      state.clientId = msg.id;
    } else if (msg.type === 'progress') {
      updateJob(msg.jobId, { stage: msg.stage, percent: msg.percent });
    } else if (msg.type === 'done') {
      finishJob(msg.jobId, msg.downloadUrl, msg.filename);
    } else if (msg.type === 'error') {
      errorJob(msg.jobId, msg.message);
    }
  };

  ws.onclose = () => setTimeout(connectWS, 2000);
}

connectWS();

// ─── URL Inputs handling events tracking triggers ────────────────────────────
urlInput.addEventListener('input', () => {
  const val = urlInput.value.trim();
  urlWrap.classList.toggle('has-text', val.length > 0);
  urlWrap.dataset.platform = val.includes('youtube.com') || val.includes('youtu.be') ? 'youtube' : val.length > 0 ? 'none' : '';
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  urlWrap.classList.remove('has-text');
  urlWrap.dataset.platform = '';
  state.tracks = [];
  state.selected.clear();
  trackCard.classList.add('hidden');
  updateConvertBtn();
});

// ─── Fetch Information Pipeline ───────────────────────────────────────────────
fetchBtn.addEventListener('click', fetchInfo);
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchInfo(); });

async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) return;

  fetchBtn.disabled = true;
  fetchBtn.querySelector('i').className = 'fa-solid fa-spinner fa-spin';
  fetchBtn.querySelector('span').textContent = 'Fetching…';
  trackCard.classList.add('hidden');

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed extraction lookup parameter');

    state.tracks = data.items;
    state.selected = new Set(data.items.map(t => t.id));
    renderTracks();
    trackCard.classList.remove('hidden');
    trackListLabel.textContent = data.isPlaylist ? 'Playlist Tracks' : 'Track';
  } catch (err) {
    alert('Lookup Failed: ' + err.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector('i').className = 'fa-solid fa-magnifying-glass';
    fetchBtn.querySelector('span').textContent = 'Fetch';
    updateConvertBtn();
  }
}

function renderTracks() {
  trackList.innerHTML = '';
  trackCount.textContent = state.tracks.length;

  state.tracks.forEach(track => {
    const item = document.createElement('div');
    item.className = 'track-item' + (state.selected.has(track.id) ? ' selected' : '');
    item.dataset.id = track.id;

    const thumb = track.thumbnail
      ? `<img class="track-thumb" src="${track.thumbnail}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="track-thumb-placeholder" style="display:none"><i class="fa-solid fa-music"></i></div>`
      : `<div class="track-thumb-placeholder"><i class="fa-solid fa-music"></i></div>`;

    item.innerHTML = `
      <div class="track-checkbox"><i class="fa-solid fa-check"></i></div>
      ${thumb}
      <div class="track-info">
        <div class="track-title">${escHtml(track.title)}</div>
        <div class="track-meta"><span>${escHtml(track.uploader)}</span></div>
      </div>
      ${track.duration ? `<div class="track-duration">${formatDuration(track.duration)}</div>` : ''}
    `;

    item.addEventListener('click', () => {
      if (state.selected.has(track.id)) state.selected.delete(track.id);
      else state.selected.add(track.id);
      item.classList.toggle('selected', state.selected.has(track.id));
      updateConvertBtn();
    });
    trackList.appendChild(item);
  });
}

selectAllBtn.addEventListener('click', () => {
  state.tracks.forEach(t => state.selected.add(t.id));
  trackList.querySelectorAll('.track-item').forEach(el => el.classList.add('selected'));
  updateConvertBtn();
});

deselectAllBtn.addEventListener('click', () => {
  state.selected.clear();
  trackList.querySelectorAll('.track-item').forEach(el => el.classList.remove('selected'));
  updateConvertBtn();
});

// ─── Settings Panel Management ────────────────────────────────────────────────
const qualityMap = ['128', '192', '256', '320'];

$('qualitySlider').addEventListener('input', function() {
  state.settings.quality = qualityMap[this.value];
  $('qualityVal').textContent = `${qualityMap[this.value]} kbps`;
  updateSliderFill(this);
});

$('speedSlider').addEventListener('input', function() {
  state.settings.speed = this.value / 100;
  $('speedVal').textContent = `${(this.value / 100).toFixed(1)}×`;
  updateSliderFill(this);
});

$('pitchSlider').addEventListener('input', function() {
  state.settings.pitch = parseInt(this.value);
  $('pitchVal').textContent = (this.value > 0 ? `+${this.value}` : this.value) + ' st';
  updateSliderFill(this);
});

function updateSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
}

// Initialize sliders setup configuration metrics profiles execution hook
['qualitySlider', 'speedSlider', 'pitchSlider'].forEach(id => updateSliderFill($(id)));
// FIX: Force visual layout fill metrics profile baseline for quality tracking map
updateSliderFill($('qualitySlider'));

normalizeToggle.addEventListener('click', () => {
  const pressed = normalizeToggle.getAttribute('aria-pressed') === 'true';
  normalizeToggle.setAttribute('aria-pressed', !pressed);
  state.settings.normalize = !pressed;
});

// ─── Convert Actions Pipeline ─────────────────────────────────────────────────
function updateConvertBtn() {
  // If no track selected, or we are already processing a job layout track list block, disable interface trigger
  convertBtn.disabled = state.selected.size === 0 || state.activeProcessingCount > 0;
}

convertBtn.addEventListener('click', () => {
  const selectedTracks = state.tracks.filter(t => state.selected.has(t.id));
  if (selectedTracks.length === 0 || state.activeProcessingCount > 0) return;

  jobsSection.classList.remove('hidden');
  
  // ANTI-SPAM PROTECTION: Increment counter and lock UI immediately
  state.activeProcessingCount = selectedTracks.length;
  convertBtn.disabled = true;
  convertBtn.querySelector('span').textContent = 'Processing...';

  selectedTracks.forEach(track => startConversion(track));
});

async function startConversion(track) {
  const uiId = createJobUI(track.title);

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: track.url,
        clientId: state.clientId,
        title: track.title,
        quality: state.settings.quality,
        normalize: state.settings.normalize,
        speed: state.settings.speed,
        pitch: state.settings.pitch
      })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Server error');
    state.jobs[data.jobId] = uiId;
  } catch (err) {
    errorJobUI(uiId, err.message);
    decrementProcessingCounter();
  }
}

// ─── Queue Monitor UI Utilities ───────────────────────────────────────────────
let jobCounter = 0;
function createJobUI(title) {
  const id = 'job-' + (++jobCounter);
  const el = document.createElement('div');
  el.className = 'job-item';
  el.id = id;
  el.innerHTML = `
    <div class="job-header">
      <div class="job-status-icon running"><i class="fa-solid fa-waveform-lines fa-spin"></i></div>
      <div class="job-title">${escHtml(title)}</div>
      <div class="job-stage">queued</div>
    </div>
    <div class="job-progress"><div class="job-progress-fill"></div></div>
  `;
  jobsList.prepend(el);
  return id;
}

function updateJob(serverJobId, { stage, percent }) {
  const uiId = state.jobs[serverJobId];
  const el = $(uiId);
  if (!el) return;
  el.querySelector('.job-stage').textContent = stage;
  el.querySelector('.job-progress-fill').style.width = percent + '%';
}

function finishJob(serverJobId, downloadUrl, filename) {
  const uiId = state.jobs[serverJobId];
  const el = $(uiId);
  if (!el) return;

  el.classList.add('done');
  el.querySelector('.job-status-icon').className = 'job-status-icon done';
  el.querySelector('.job-status-icon').innerHTML = '<i class="fa-solid fa-check"></i>';
  el.querySelector('.job-stage').textContent = 'done';
  el.querySelector('.job-progress-fill').classList.add('done');

  const a = document.createElement('a');
  a.href = `${downloadUrl}?name=${encodeURIComponent(filename)}`;
  a.className = 'download-btn';
  a.innerHTML = '<i class="fa-solid fa-arrow-down-to-line"></i> Download MP3';
  el.appendChild(a);

  decrementProcessingCounter();
}

function errorJob(serverJobId, msg) {
  const uiId = state.jobs[serverJobId];
  errorJobUI(uiId, msg);
  decrementProcessingCounter();
}

function errorJobUI(uiId, msg) {
  const el = $(uiId);
  if (!el) return;
  el.classList.add('error');
  el.querySelector('.job-status-icon').className = 'job-status-icon error';
  el.querySelector('.job-status-icon').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
  el.querySelector('.job-stage').textContent = 'error';
  el.querySelector('.job-progress').remove();

  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'font-size:12px;color:var(--red);opacity:0.8;';
  errDiv.textContent = msg || 'Conversion Pipeline Error';
  el.appendChild(errDiv);
}

function decrementProcessingCounter() {
  state.activeProcessingCount = Math.max(0, state.activeProcessingCount - 1);
  if (state.activeProcessingCount === 0) {
    convertBtn.querySelector('span').textContent = 'Convert to MP3';
    updateConvertBtn();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}