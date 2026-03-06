/* ═══════════════════════════════════════════════════════════
   Word Party – Client  (dynamic categories from dataset)
   ═══════════════════════════════════════════════════════════ */

const socket = io();

// ── State ─────────────────────────────────────────────────
let myId = null;
let roomCode = null;
let isHost = false;
let gameMode = 'solo';
let timerInterval = null;
const TURN_TIME = 20; // seconds per turn

// Categories fetched from server (loaded from dataset)
let ALL_CATEGORIES = [];           // [{ key, label, count }]
let selectedCategories = new Set();

// ── DOM refs ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Screens
const screens = {
  home:     $('#screen-home'),
  host:     $('#screen-host'),
  join:     $('#screen-join'),
  lobby:    $('#screen-lobby'),
  game:     $('#screen-game'),
  gameover: $('#screen-gameover'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Toasts ────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ── Fetch categories from server at startup ───────────────
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    ALL_CATEGORIES = await res.json();
    // Default-select a few popular ones
    const defaults = ['fruits', 'countries', 'animals', 'cities', 'colors', 'any'];
    ALL_CATEGORIES.forEach(c => {
      if (defaults.includes(c.key)) selectedCategories.add(c.key);
    });
  } catch (e) {
    console.error('Failed to load categories', e);
    toast('Failed to load categories from server.', 'error');
  }
}
loadCategories();

// ══════════════════════════════════════════════════════════
//  HOME SCREEN
// ══════════════════════════════════════════════════════════
$('#btn-host').addEventListener('click', () => showScreen('host'));
$('#btn-join').addEventListener('click', () => showScreen('join'));

// Back buttons
$$('.btn-back').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

// ══════════════════════════════════════════════════════════
//  HOST SETUP
// ══════════════════════════════════════════════════════════
$$('input[name="mode"]').forEach(el => {
  el.addEventListener('change', () => {
    const team = el.value === 'team';
    $('#host-team-section').classList.toggle('hidden', !team);
    if (team) generateTeamNameInputs();
  });
});

/** Generate dynamic team name inputs + host team selector */
function generateTeamNameInputs() {
  const numTeams = parseInt($('#host-num-teams').value) || 2;
  const list = $('#team-names-list');
  const sel = $('#host-team-select');
  list.innerHTML = '';
  sel.innerHTML = '';

  for (let i = 1; i <= numTeams; i++) {
    const defaultName = `Team ${i}`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'team-name-input';
    inp.placeholder = defaultName;
    inp.maxLength = 20;
    inp.dataset.idx = i;
    inp.value = defaultName;
    inp.addEventListener('input', updateHostTeamSelect);
    list.appendChild(inp);
  }
  updateHostTeamSelect();
}

function updateHostTeamSelect() {
  const sel = $('#host-team-select');
  const prev = sel.value;
  sel.innerHTML = '';
  $$('.team-name-input').forEach(inp => {
    const name = inp.value.trim() || inp.placeholder;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  // Restore previous selection if still present
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

$('#host-num-teams').addEventListener('change', generateTeamNameInputs);

$('#btn-create-room').addEventListener('click', () => {
  const name = $('#host-name').value.trim();
  if (!name) return toast('Enter your name.', 'error');

  const mode = $('input[name="mode"]:checked').value;

  if (mode === 'team') {
    const maxPlayers = parseInt($('#host-max-per-team').value) || 4;
    const teamInputs = $$('.team-name-input');
    const teamConfig = [];
    const seen = new Set();
    for (const inp of teamInputs) {
      const tName = (inp.value.trim() || inp.placeholder).trim();
      if (!tName) return toast('All teams need a name.', 'error');
      if (seen.has(tName.toLowerCase())) return toast(`Duplicate team name: "${tName}".`, 'error');
      seen.add(tName.toLowerCase());
      teamConfig.push({ name: tName, maxPlayers });
    }
    const hostTeam = $('#host-team-select').value;
    if (!hostTeam) return toast('Select your team.', 'error');
    socket.emit('host-game', { hostName: name, mode, teamConfig, hostTeam });
  } else {
    socket.emit('host-game', { hostName: name, mode });
  }
});

// ══════════════════════════════════════════════════════════
//  JOIN SCREEN (two-step flow for team mode)
// ══════════════════════════════════════════════════════════
let joinSelectedTeam = null;   // team the joining player picked
let joinRoomMode = 'solo';     // mode of the room being joined

$('#btn-check-room').addEventListener('click', () => {
  const code = $('#join-code').value.trim().toUpperCase();
  const name = $('#join-name').value.trim();
  if (!code || code.length < 4) return toast('Enter a valid party code.', 'error');
  if (!name) return toast('Enter your name.', 'error');
  socket.emit('get-room-info', { code });
});

/** Server responds with room info so we can show team picker */
socket.on('room-info', (data) => {
  joinRoomMode = data.mode;

  if (data.mode === 'solo') {
    // Solo — skip team picker, join directly
    const code = $('#join-code').value.trim().toUpperCase();
    const name = $('#join-name').value.trim();
    socket.emit('join-game', { code, playerName: name, teamName: null });
  } else {
    // Team mode — show team picker
    $('#join-step1').classList.add('hidden');
    $('#join-step2').classList.remove('hidden');
    joinSelectedTeam = null;

    const msg = $('#join-room-mode-msg');
    msg.textContent = 'Pick your team:';

    const picker = $('#join-team-picker');
    picker.innerHTML = '';

    if (!data.availableTeams || data.availableTeams.length === 0) {
      picker.innerHTML = '<p style="color:#f44">All teams are full!</p>';
      $('#btn-join-room').disabled = true;
      return;
    }

    $('#btn-join-room').disabled = false;

    data.availableTeams.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'team-pick-btn';
      btn.innerHTML = `<strong>${t.name}</strong><span class="team-slots">${t.currentCount} / ${t.maxPlayers}</span>`;
      btn.addEventListener('click', () => {
        $$('.team-pick-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        joinSelectedTeam = t.name;
      });
      picker.appendChild(btn);
    });
  }
});

$('#btn-join-back-step1').addEventListener('click', () => {
  $('#join-step1').classList.remove('hidden');
  $('#join-step2').classList.add('hidden');
});

$('#btn-join-room').addEventListener('click', () => {
  const code = $('#join-code').value.trim().toUpperCase();
  const name = $('#join-name').value.trim();
  if (!code || !name) return toast('Missing code or name.', 'error');

  if (joinRoomMode === 'team' && !joinSelectedTeam) {
    return toast('Select a team first.', 'error');
  }

  socket.emit('join-game', { code, playerName: name, teamName: joinSelectedTeam });
});

// ══════════════════════════════════════════════════════════
//  LOBBY
// ══════════════════════════════════════════════════════════

function renderLobby(code, players, mode, teams) {
  roomCode = code;
  gameMode = mode;
  isHost = players.some(p => p.id === socket.id && p.isHost);

  $('#lobby-code').textContent = code;

  const badge = $('#lobby-mode-badge');
  badge.textContent = mode === 'team' ? 'Team Battle' : 'Solo';
  badge.className = `mode-badge ${mode}`;

  // Player list
  renderPlayerList(players);

  // Team list
  renderTeamList(mode, teams);

  // Host controls
  if (isHost) {
    $('#host-controls').classList.remove('hidden');
    $('#waiting-msg').classList.add('hidden');
    renderCategoryPicker();
  } else {
    $('#host-controls').classList.add('hidden');
    $('#waiting-msg').classList.remove('hidden');
  }

  showScreen('lobby');
}

function renderPlayerList(players) {
  const pl = $('#lobby-players');
  pl.innerHTML = '';
  if (gameMode !== 'team') {
    players.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'player-chip';
      chip.innerHTML = `${p.isHost ? '<span class="host-star">★</span>' : ''}${p.name}`;
      pl.appendChild(chip);
    });
  }
}

function renderTeamList(mode, teams) {
  const tl = $('#lobby-teams');
  tl.innerHTML = '';
  if (mode === 'team' && teams) {
    Object.entries(teams).forEach(([team, info]) => {
      const block = document.createElement('div');
      block.className = 'team-block';
      block.innerHTML = `
        <h4>${team} <span class="team-capacity">(${info.count} / ${info.maxPlayers})</span></h4>
        ${info.members.map(m => `<span class="player-chip">${m}</span>`).join('') || '<span class="empty-team">No members yet</span>'}
      `;
      tl.appendChild(block);
    });
  }
}

function renderCategoryPicker() {
  const grid = $('#category-picker');
  grid.innerHTML = '';

  if (ALL_CATEGORIES.length === 0) {
    grid.innerHTML = '<p style="color:#888">Loading categories…</p>';
    setTimeout(renderCategoryPicker, 500);
    return;
  }

  ALL_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `cat-btn${selectedCategories.has(cat.key) ? ' selected' : ''}`;
    btn.innerHTML = `${cat.label}<span class="cat-count">${cat.count}</span>`;
    btn.addEventListener('click', () => {
      if (selectedCategories.has(cat.key)) {
        selectedCategories.delete(cat.key);
        btn.classList.remove('selected');
      } else {
        selectedCategories.add(cat.key);
        btn.classList.add('selected');
      }
    });
    grid.appendChild(btn);
  });
}

$('#btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode).then(() => toast('Code copied!', 'success'));
});

$('#btn-start-game').addEventListener('click', () => {
  if (selectedCategories.size === 0) return toast('Select at least one category.', 'error');
  const rounds = parseInt($('#round-select').value);
  socket.emit('start-game', { code: roomCode, categories: [...selectedCategories], rounds });
});

// ══════════════════════════════════════════════════════════
//  GAME SCREEN
// ══════════════════════════════════════════════════════════

/** Find the display label for a category key */
function catLabel(key) {
  const found = ALL_CATEGORIES.find(c => c.key === key);
  return found ? found.label : key;
}

function startTurn(turn) {
  $('#game-round').textContent = turn.round;
  $('#game-category').textContent = catLabel(turn.category);
  $('#turn-player').textContent = turn.playerName;
  $('#word-input').value = '';

  const isMyTurn = turn.playerId === socket.id;
  $('#my-turn-controls').classList.toggle('hidden', !isMyTurn);
  $('#input-category').textContent = catLabel(turn.category);

  // Store raw category key for submit
  $('#word-input').dataset.category = turn.category;

  if (isMyTurn) {
    $('#word-input').focus();
    startTimer();
  } else {
    clearTimer();
  }
}

function startTimer() {
  clearTimer();
  let remaining = TURN_TIME;
  const fill = $('#timer-fill');
  fill.style.width = '100%';
  fill.className = 'timer-fill';

  timerInterval = setInterval(() => {
    remaining -= 0.1;
    const pct = (remaining / TURN_TIME) * 100;
    fill.style.width = pct + '%';

    if (pct < 25) fill.className = 'timer-fill danger';
    else if (pct < 50) fill.className = 'timer-fill warning';

    if (remaining <= 0) {
      clearTimer();
      socket.emit('skip-turn', { code: roomCode });
    }
  }, 100);
}

function clearTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

$('#btn-submit-word').addEventListener('click', submitWord);
$('#word-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitWord();
});

function submitWord() {
  const word = $('#word-input').value.trim();
  if (!word) return toast('Type a word!', 'error');
  const category = $('#word-input').dataset.category; // raw key
  clearTimer();
  socket.emit('submit-word', { code: roomCode, word, category });
  $('#word-input').value = '';
}

$('#btn-skip').addEventListener('click', () => {
  clearTimer();
  socket.emit('skip-turn', { code: roomCode });
});

// ── Speech-to-Text (Mic) ──────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.addEventListener('result', (e) => {
    const spoken = e.results[0][0].transcript.trim().toLowerCase();
    // Take only the first word (strip extra words)
    const firstWord = spoken.split(/\s+/)[0].replace(/[^a-z'-]/g, '');
    if (firstWord) {
      $('#word-input').value = firstWord;
      setMicStatus(`Heard: "${firstWord}"`, 'success');
    } else {
      setMicStatus('Could not understand, try again.', 'error');
    }
    stopListening();
  });

  recognition.addEventListener('error', (e) => {
    if (e.error === 'no-speech') {
      setMicStatus('No speech detected. Try again.', 'error');
    } else if (e.error === 'not-allowed') {
      setMicStatus('Microphone access denied.', 'error');
    } else {
      setMicStatus(`Mic error: ${e.error}`, 'error');
    }
    stopListening();
  });

  recognition.addEventListener('end', () => {
    stopListening();
  });
}

function startListening() {
  if (!recognition) return toast('Speech recognition not supported in this browser.', 'error');
  if (isListening) { stopListening(); return; }
  isListening = true;
  $('#btn-mic').classList.add('listening');
  setMicStatus('Listening… speak now', 'info');
  try { recognition.start(); } catch(e) { /* already started */ }
}

function stopListening() {
  isListening = false;
  $('#btn-mic').classList.remove('listening');
  try { recognition.stop(); } catch(e) { /* not started */ }
}

function setMicStatus(msg, type) {
  const el = $('#mic-status');
  el.textContent = msg;
  el.className = `mic-status ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

$('#btn-mic').addEventListener('click', startListening);

function addFeedItem(data) {
  const feed = $('#game-feed');
  const item = document.createElement('div');
  item.className = `feed-item ${data.valid ? 'valid' : 'invalid'}`;
  const teamTag = data.team ? ` [${data.team}]` : '';
  const label = catLabel(data.category);
  item.innerHTML = `
    <strong>${data.player}${teamTag}</strong>: "${data.word}" 
    <em>(${label})</em>
    ${data.valid ? '✅' : '❌ ' + data.reason}
    <span class="pts">${data.valid ? '+' + data.points : '0'}</span>
  `;
  feed.prepend(item);
}

// ══════════════════════════════════════════════════════════
//  GAME OVER / LEADERBOARD
// ══════════════════════════════════════════════════════════
function renderLeaderboard(leaderboard, mode) {
  const lb = $('#leaderboard');
  lb.innerHTML = '';

  leaderboard.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'lb-row';

    const rankClass = entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : '';

    if (mode === 'team') {
      row.innerHTML = `
        <span class="lb-rank ${rankClass}">#${entry.rank}</span>
        <span class="lb-name">${entry.name}<br><span class="lb-members">${entry.members.map(m => m.name).join(', ')}</span></span>
        <span class="lb-score">${entry.score} pts</span>
      `;
    } else {
      row.innerHTML = `
        <span class="lb-rank ${rankClass}">#${entry.rank}</span>
        <span class="lb-name">${entry.name}</span>
        <span class="lb-score">${entry.score} pts</span>
      `;
    }
    lb.appendChild(row);
  });
}

$('#btn-play-again').addEventListener('click', () => {
  roomCode = null;
  isHost = false;
  // Reset default selections
  selectedCategories = new Set();
  const defaults = ['fruits', 'countries', 'animals', 'cities', 'colors', 'any'];
  ALL_CATEGORIES.forEach(c => {
    if (defaults.includes(c.key)) selectedCategories.add(c.key);
  });
  clearTimer();
  showScreen('home');
});

// ══════════════════════════════════════════════════════════
//  SOCKET EVENTS
// ══════════════════════════════════════════════════════════
socket.on('connect', () => { myId = socket.id; });

socket.on('room-created', (data) => {
  renderLobby(data.code, data.players, data.mode, data.teams);
  toast(`Room ${data.code} created!`, 'success');
});

socket.on('joined-room', (data) => {
  renderLobby(data.code, data.players, data.mode, data.teams);
  toast('Joined the room!', 'success');
});

socket.on('player-joined', (data) => {
  renderPlayerList(data.players);
  renderTeamList(gameMode, data.teams);
  toast('A new player joined!', 'info');
});

socket.on('player-left', (data) => {
  renderPlayerList(data.players);
  renderTeamList(gameMode, data.teams);
  toast('A player left.', 'info');
});

socket.on('host-changed', ({ newHostId }) => {
  isHost = newHostId === socket.id;
  if (isHost) {
    toast("You're the host now!", 'info');
    $('#host-controls').classList.remove('hidden');
    $('#waiting-msg').classList.add('hidden');
    renderCategoryPicker();
  }
});

socket.on('game-started', (data) => {
  $('#game-total-rounds').textContent = data.rounds;
  $('#game-feed').innerHTML = '';
  clearTimer();
  showScreen('game');
  startTurn(data.turn);
  toast('Game started! 🎮', 'success');
});

socket.on('word-result', (data) => {
  addFeedItem(data);
});

socket.on('next-turn', (data) => {
  $('#game-round').textContent = data.currentRound;
  startTurn(data.turn);
});

socket.on('game-over', (data) => {
  clearTimer();
  renderLeaderboard(data.leaderboard, data.mode);
  showScreen('gameover');
  toast('Game over! 🏆', 'success');
});

socket.on('room-closed', () => {
  toast('Room has been closed.', 'info');
  showScreen('home');
});

socket.on('error-msg', (msg) => {
  toast(msg, 'error');
});
