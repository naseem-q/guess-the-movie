require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const rooms = {};

function genCode() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code; do { code = Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join(''); } while (rooms[code]); return code; }
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function normalize(s) { return s.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]/g, ''); }
async function tmdb(ep) { const url = `https://api.themoviedb.org/3${ep}${ep.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=en-US`; const r = await fetch(url); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); }

// ═══ TMDB CACHE ══════════════════════════════════════
const cache = { movies: null, tv: null, ts: 0 };
async function loadTMDB() {
  if (cache.movies && Date.now() - cache.ts < 3600000) return;
  console.log('[TMDB] Loading...');
  try {
    const movies = [], tv = [];
    for (const p of [1, 2, 3, 4, 5, 6]) {
      try { const d = await tmdb(`/movie/popular?page=${p}`); movies.push(...(d.results || []).filter(m => m.poster_path && m.backdrop_path && m.title && m.original_language === 'en')); } catch (e) {}
      try { const d = await tmdb(`/tv/popular?page=${p}`); tv.push(...(d.results || []).filter(t => t.poster_path && t.backdrop_path && t.name && t.original_language === 'en')); } catch (e) {}
    }
    cache.movies = movies; cache.tv = tv; cache.ts = Date.now();
    console.log(`[TMDB] ${movies.length} movies, ${tv.length} TV`);
  } catch (e) { console.error('[TMDB]', e.message); if (!cache.movies) { cache.movies = []; cache.tv = []; } }
}

// ═══ IMAGE HELPERS ═══════════════════════════════════
async function getTextlessPoster(id, type) {
  try { const d = await tmdb(`/${type}/${id}/images?include_image_language=null`); const t = (d.posters || []).filter(p => p.file_path && !p.iso_639_1); if (t.length > 0) return `${TMDB_IMG}w780${t[Math.floor(Math.random() * Math.min(t.length, 4))].file_path}`; const a = (d.posters || []).slice(1).filter(p => p.file_path); if (a.length > 0) return `${TMDB_IMG}w780${a[Math.floor(Math.random() * Math.min(a.length, 4))].file_path}`; } catch (e) {} return null;
}
async function getSceneStill(id, type) {
  try { const d = await tmdb(`/${type}/${id}/images?include_image_language=null`); const b = (d.backdrops || []).filter(x => x.file_path); if (b.length > 2) { const p = b.slice(1); return `${TMDB_IMG}w1280${p[Math.floor(Math.random() * Math.min(p.length, 6))].file_path}`; } if (b.length > 0) return `${TMDB_IMG}w1280${b[0].file_path}`; } catch (e) {} return null;
}
async function getTVStill(tvId) {
  try { const s = await tmdb(`/tv/${tvId}/season/1`); if (s.episodes) { const eps = s.episodes.filter(e => e.still_path); if (eps.length > 0) return `${TMDB_IMG}w1280${eps[Math.floor(Math.random() * eps.length)].still_path}`; } } catch (e) {} return null;
}
async function getActorCharacter(person) {
  try {
    const cr = await tmdb(`/person/${person.id}/combined_credits`);
    if (!cr.cast?.length) return null;
    const roles = cr.cast.filter(r => r.character?.length > 0 && r.character.length < 40 && !r.character.includes('/') && r.original_language === 'en').sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    if (!roles.length) return null;
    const role = roles[0]; const title = role.title || role.name; const mt = role.media_type || (role.title ? 'movie' : 'tv');
    let others = [];
    try { const sc = await tmdb(`/${mt}/${role.id}/credits`); others = (sc.cast || []).filter(c => c.character?.length > 0 && c.character.length < 40 && normalize(c.character) !== normalize(role.character) && !c.character.includes('/') && !c.character.includes('(')).map(c => c.character); } catch (e) {}
    if (others.length < 3) { for (const r of roles.slice(1, 6)) { if (r.character && normalize(r.character) !== normalize(role.character)) others.push(r.character); if (others.length >= 3) break; } }
    if (others.length < 3) return null;
    return { actor: person.name, image: `${TMDB_IMG}h632${person.profile_path}`, character: role.character, show: title, wrong: shuffle(others).slice(0, 3) };
  } catch (e) { return null; }
}

// ═══ QUESTION GENERATORS ═════════════════════════════
async function genMoviePosterQ() {
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  let img = await getTextlessPoster(m.id, 'movie'); if (!img) img = `${TMDB_IMG}w780${m.poster_path}`;
  return { type: 'movie_poster', category: 'Movie Posters', question: 'What movie is this?', image: img, revealImage: `${TMDB_IMG}w780${m.poster_path}`, answer: m.title, options: shuffle([m.title, ...shuffle(cache.movies.filter(x => x.id !== m.id).map(x => x.title)).slice(0, 3)]), year: m.release_date?.split('-')[0] || '', info: m.title };
}
async function genTVPosterQ() {
  const s = cache.tv[Math.floor(Math.random() * cache.tv.length)];
  let img = await getTextlessPoster(s.id, 'tv'); if (!img) img = `${TMDB_IMG}w780${s.poster_path}`;
  return { type: 'tv_poster', category: 'TV Show Posters', question: 'What TV show is this?', image: img, revealImage: `${TMDB_IMG}w780${s.poster_path}`, answer: s.name, options: shuffle([s.name, ...shuffle(cache.tv.filter(x => x.id !== s.id).map(x => x.name)).slice(0, 3)]), year: s.first_air_date?.split('-')[0] || '', info: s.name };
}
async function genMovieSceneQ() {
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  let img = await getSceneStill(m.id, 'movie'); if (!img) img = `${TMDB_IMG}w1280${m.backdrop_path}`;
  return { type: 'movie_scene', category: 'Movie Scenes', question: 'What movie is this scene from?', image: img, revealImage: img, answer: m.title, options: shuffle([m.title, ...shuffle(cache.movies.filter(x => x.id !== m.id).map(x => x.title)).slice(0, 3)]), year: m.release_date?.split('-')[0] || '', info: m.title };
}
async function genTVSceneQ() {
  const s = cache.tv[Math.floor(Math.random() * cache.tv.length)];
  let img = await getTVStill(s.id); if (!img) img = await getSceneStill(s.id, 'tv'); if (!img) img = `${TMDB_IMG}w1280${s.backdrop_path}`;
  return { type: 'tv_scene', category: 'TV Show Scenes', question: 'What TV show is this scene from?', image: img, revealImage: img, answer: s.name, options: shuffle([s.name, ...shuffle(cache.tv.filter(x => x.id !== s.id).map(x => x.name)).slice(0, 3)]), year: s.first_air_date?.split('-')[0] || '', info: s.name };
}
async function genCharacterQ() {
  const page = Math.floor(Math.random() * 3) + 1;
  try {
    const pd = await tmdb(`/person/popular?page=${page}`);
    for (const p of shuffle((pd.results || []).filter(x => x.profile_path && x.name)).slice(0, 10)) {
      const r = await getActorCharacter(p);
      if (r) return { type: 'character', category: 'Guess the Character', question: `What character does this actor play in "${r.show}"?`, image: r.image, revealImage: r.image, answer: r.character, options: shuffle([r.character, ...r.wrong]), year: '', info: `${r.character} (${r.actor}) — ${r.show}` };
    }
  } catch (e) {}
  // fallback
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  return { type: 'character', category: 'Guess the Character', question: 'What movie is this from?', image: `${TMDB_IMG}w1280${m.backdrop_path}`, revealImage: `${TMDB_IMG}w1280${m.backdrop_path}`, answer: m.title, options: shuffle([m.title, ...shuffle(cache.movies.filter(x => x.id !== m.id).map(x => x.title)).slice(0, 3)]), year: '', info: m.title };
}

const GENS = { movie_posters: genMoviePosterQ, tv_posters: genTVPosterQ, movie_scenes: genMovieSceneQ, tv_scenes: genTVSceneQ, characters: genCharacterQ };
async function genRound(type, n = 10) { const qs = [], used = new Set(); for (let i = 0; i < n; i++) { let q, a = 0; do { a++; q = await GENS[type](); } while (used.has(normalize(q.answer)) && a < 30); used.add(normalize(q.answer)); qs.push(q); console.log(`  [Q${i + 1}] ${q.answer}`); } return qs; }

// ═══ CONFIG ══════════════════════════════════════════
const DIFF = { easy: { timer: 45, startBlur: 28, startRadius: 7, blurDecayPower: 1.4 }, medium: { timer: 50, startBlur: 42, startRadius: 5, blurDecayPower: 1.7 }, hard: { timer: 60, startBlur: 60, startRadius: 3, blurDecayPower: 2.0 } };
const LABELS = { movie_posters: 'Movie Posters', tv_posters: 'TV Show Posters', movie_scenes: 'Movie Scenes', tv_scenes: 'TV Show Scenes', characters: 'Guess the Character' };
const ICONS = { movie_posters: '🎬', tv_posters: '📺', movie_scenes: '🎞️', tv_scenes: '📡', characters: '🌟' };

const CATEGORIES = {
  movies_tv: { name: 'Movies & TV Shows', icon: '🎬', available: true, rounds: ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'] },
  flags: { name: 'Flags', icon: '🚩', available: false, rounds: [] },
  famous_people: { name: 'Famous People', icon: '👤', available: false, rounds: [] },
  football_clubs: { name: 'Football Clubs', icon: '⚽', available: false, rounds: [] },
  sports_players: { name: 'Sports Players', icon: '🏆', available: false, rounds: [] }
};

// Serve categories via REST endpoint (more reliable than socket event)
app.get('/api/categories', (req, res) => res.json(CATEGORIES));

// ═══ SOCKET.IO ═══════════════════════════════════════
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('create-game', async ({ playerName, difficulty, category }, cb) => {
    console.log(`[Create] category="${category}" difficulty="${difficulty}" player="${playerName}"`);
    const cat = CATEGORIES[category];
    if (!cat) return cb({ error: `Invalid category: ${category}` });
    if (!cat.available) return cb({ error: `${cat.name} coming soon!` });
    await loadTMDB();
    if (!cache.movies?.length) return cb({ error: 'Cannot load movies. Check TMDB API key.' });

    const code = genCode(); const diff = DIFF[difficulty] || DIFF.medium;
    console.log(`[${code}] Generating ${cat.name}...`);
    const allQ = {};
    for (const r of cat.rounds) { console.log(`[${code}] ${LABELS[r]}`); allQ[r] = await genRound(r, 10); }
    console.log(`[${code}] Ready!`);

    rooms[code] = { code, masterId: socket.id, diff, diffName: difficulty || 'medium', category, categoryName: cat.name, activeRounds: cat.rounds, allQ, players: {}, hostId: null, state: 'lobby', rIdx: 0, qIdx: 0, qStart: null, qTimer: null, answers: {}, created: Date.now() };
    rooms[code].players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: true };
    socket.join(code); socket.roomCode = code;
    cb({ code, rounds: cat.rounds, categoryName: cat.name });
  });

  socket.on('host-connect', ({ code }, cb) => {
    const r = rooms[code]; if (!r) return cb({ error: 'Room not found.' });
    r.hostId = socket.id; socket.join(code); socket.roomCode = code; socket.isHost = true;
    cb({ ok: true, players: Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })), state: r.state, categoryName: r.categoryName });
  });

  socket.on('join-game', ({ code, playerName }, cb) => {
    const r = rooms[code]; if (!r) return cb({ error: 'Room not found' });
    if (r.state !== 'lobby') return cb({ error: 'Game started' });
    if (Object.keys(r.players).length >= 8) return cb({ error: 'Room full' });
    if (Object.values(r.players).some(p => p.name.toLowerCase() === playerName.toLowerCase())) return cb({ error: 'Name taken' });
    r.players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: false };
    socket.join(code); socket.roomCode = code;
    const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
    io.to(code).emit('player-list-update', pl);
    cb({ ok: true, players: pl, categoryName: r.categoryName });
  });

  socket.on('start-game', (_, cb) => { const r = rooms[socket.roomCode]; if (!r || r.masterId !== socket.id) return cb?.({ error: 'Cannot start' }); r.state = 'round_intro'; r.rIdx = 0; r.qIdx = 0; startRound(r); cb?.({ ok: true }); });

  socket.on('submit-answer', ({ choice }, cb) => {
    const r = rooms[socket.roomCode]; if (!r || r.state !== 'question' || r.answers[socket.id]) return cb?.({ error: 'No' });
    const elapsed = (Date.now() - r.qStart) / 1000; const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx]; const correct = choice === q.answer;
    let pts = 0; if (correct) { pts = Math.round(100 + 900 * Math.max(0, 1 - elapsed / r.diff.timer)); if (r.players[socket.id]) r.players[socket.id].score += pts; }
    r.answers[socket.id] = { choice, time: elapsed, correct, points: pts };
    cb?.({ correct, points: pts, answer: q.answer });
    const ac = Object.keys(r.answers).length, tc = Object.values(r.players).filter(p => p.connected).length;
    io.to(r.code).emit('answer-progress', { answered: ac, total: tc });
    if (ac >= tc) { clearTimeout(r.qTimer); setTimeout(() => reveal(r), 500); }
  });

  socket.on('skip-question', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.qTimer); nextQ(r); } });
  socket.on('pause-game', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.qTimer); r.state = 'paused'; io.to(r.code).emit('game-paused'); } });
  socket.on('resume-game', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { r.state = 'question'; const rem = r.diff.timer - ((Date.now() - r.qStart) / 1000); io.to(r.code).emit('game-resumed'); r.qTimer = setTimeout(() => reveal(r), rem * 1000); } });
  socket.on('end-game-early', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.qTimer); finalResults(r); } });
  socket.on('next-question-request', () => { const r = rooms[socket.roomCode]; if (!r || r.masterId !== socket.id) return; if (r.state === 'question_reveal') nextQ(r); if (r.state === 'round_results') { r.rIdx++; r.qIdx = 0; r.rIdx >= r.activeRounds.length ? finalResults(r) : startRound(r); } });
  socket.on('play-again', () => { const code = socket.roomCode; if (!code || !rooms[code]) return; const r = rooms[code]; if (r.masterId !== socket.id) return; io.to(code).emit('game-reset'); clearTimeout(r.qTimer); delete rooms[code]; console.log(`[${code}] Game reset by host`); });

  socket.on('disconnect', () => {
    const code = socket.roomCode; if (!code || !rooms[code]) return; const r = rooms[code];
    if (socket.isHost) r.hostId = null;
    else if (r.players[socket.id]) { r.players[socket.id].connected = false; io.to(code).emit('player-list-update', Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }))); if (r.state === 'question') { const c = Object.entries(r.players).filter(([, p]) => p.connected); if (c.every(([id]) => r.answers[id]) && c.length > 0) { clearTimeout(r.qTimer); setTimeout(() => reveal(r), 500); } } }
    if (Object.values(r.players).filter(p => p.connected).length === 0 && !r.hostId) setTimeout(() => { if (rooms[code] && Object.values(rooms[code].players).filter(p => p.connected).length === 0) delete rooms[code]; }, 300000);
  });
});

// ═══ GAME FLOW ═══════════════════════════════════════
function startRound(r) { r.state = 'round_intro'; const rt = r.activeRounds[r.rIdx]; io.to(r.code).emit('round-intro', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundType: rt, roundLabel: LABELS[rt], roundIcon: ICONS[rt], questionsCount: 10, musicTrack: r.rIdx % 4 }); setTimeout(() => { r.qIdx = 0; sendQ(r); }, 4000); }
function sendQ(r) { r.state = 'question'; r.answers = {}; const rt = r.activeRounds[r.rIdx], q = r.allQ[rt][r.qIdx]; r.qStart = Date.now(); const base = { questionNumber: r.qIdx + 1, totalQuestions: 10, roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, type: q.type, category: q.category, question: q.question, timer: r.diff.timer, options: q.options }; if (r.hostId) io.to(r.hostId).emit('question-start', { ...base, image: q.image, difficulty: r.diff }); Object.keys(r.players).forEach(sid => io.to(sid).emit('question-start', base)); r.qTimer = setTimeout(() => reveal(r), r.diff.timer * 1000); }
function reveal(r) { r.state = 'question_reveal'; clearTimeout(r.qTimer); const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx]; const results = {}; Object.entries(r.answers).forEach(([sid, a]) => { const p = r.players[sid]; if (p) results[p.name] = a; }); Object.entries(r.players).forEach(([, p]) => { if (!results[p.name]) results[p.name] = { correct: false, points: 0, time: null, choice: null }; }); const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('question-reveal', { answer: q.answer, info: q.info, year: q.year, image: q.revealImage || q.image, results, leaderboard: pl, questionNumber: r.qIdx + 1, totalQuestions: 10 }); }
function nextQ(r) { r.qIdx++; r.qIdx >= 10 ? roundResults(r) : sendQ(r); }
function roundResults(r) { r.state = 'round_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('round-results', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundLabel: LABELS[r.activeRounds[r.rIdx]], leaderboard: pl, isLastRound: r.rIdx + 1 >= r.activeRounds.length }); }
function finalResults(r) { r.state = 'final_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('final-results', { leaderboard: pl }); }

setInterval(() => { Object.entries(rooms).forEach(([c, r]) => { if (Date.now() - r.created > 5400000) { clearTimeout(r.qTimer); delete rooms[c]; } }); }, 60000);
server.listen(PORT, () => { console.log(`\n🎮 Party Game on port ${PORT}`); if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') console.log('⚠️ Set TMDB_API_KEY!\n'); });
