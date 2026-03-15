require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_IMG = 'https://image.tmdb.org/t/p/';

// Load curated questions
const questionsDB = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'questions.json'), 'utf8'));

const rooms = {};

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code; do { code = Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join(''); } while (rooms[code]);
  return code;
}
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function normalize(s) { return s.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]/g, ''); }

async function tmdbFetch(ep) {
  const url = `https://api.themoviedb.org/3${ep}${ep.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=en-US`;
  const res = await fetch(url); if (!res.ok) throw new Error(`TMDB ${res.status}`); return res.json();
}

// ─── TMDB Data (English only) ─────────────────────────────────────
const cache = { movies: null, tv: null, ts: 0 };

async function loadTMDB() {
  if (cache.movies && Date.now() - cache.ts < 3600000) return;
  console.log('[TMDB] Loading English-only content...');
  try {
    const movies = [], tv = [];
    for (const p of [1, 2, 3, 4, 5]) {
      const md = await tmdbFetch(`/movie/popular?page=${p}&with_original_language=en`);
      movies.push(...(md.results || []).filter(m => m.poster_path && m.backdrop_path && m.title && m.original_language === 'en'));
      const td = await tmdbFetch(`/tv/popular?page=${p}&with_original_language=en`);
      tv.push(...(td.results || []).filter(t => t.poster_path && t.backdrop_path && t.name && t.original_language === 'en'));
    }
    cache.movies = movies; cache.tv = tv; cache.ts = Date.now();
    console.log(`[TMDB] ${movies.length} EN movies, ${tv.length} EN TV shows`);
  } catch (e) {
    console.error('[TMDB] Error:', e.message);
    if (!cache.movies) { cache.movies = []; cache.tv = []; }
  }
}

// ─── Image helpers ────────────────────────────────────────────────
async function getTextlessPoster(id, type = 'movie') {
  try {
    const d = await tmdbFetch(`/${type}/${id}/images?include_image_language=null`);
    const textless = (d.posters || []).filter(p => p.file_path && !p.iso_639_1);
    if (textless.length > 0) return `${TMDB_IMG}w780${textless[Math.floor(Math.random() * Math.min(textless.length, 5))].file_path}`;
    const alts = (d.posters || []).slice(1);
    if (alts.length > 0) return `${TMDB_IMG}w780${alts[Math.floor(Math.random() * Math.min(alts.length, 5))].file_path}`;
  } catch (e) {}
  return null;
}

async function getSceneStill(id, type = 'movie') {
  try {
    const d = await tmdbFetch(`/${type}/${id}/images?include_image_language=null`);
    const bds = (d.backdrops || []).filter(b => b.file_path);
    // Skip first one (usually main promotional), pick from rest
    const pool = bds.length > 3 ? bds.slice(1) : bds;
    if (pool.length > 0) return `${TMDB_IMG}w1280${pool[Math.floor(Math.random() * Math.min(pool.length, 8))].file_path}`;
  } catch (e) {}
  return null;
}

async function getCharacterImage(personId) {
  try {
    const d = await tmdbFetch(`/person/${personId}/tagged_images`);
    const stills = (d.results || []).filter(i => (i.media_type === 'movie' || i.media_type === 'tv') && i.file_path);
    if (stills.length > 0) return `${TMDB_IMG}w780${stills[Math.floor(Math.random() * Math.min(stills.length, 5))].file_path}`;
    // Fallback to profile
    const pd = await tmdbFetch(`/person/${personId}`);
    if (pd.profile_path) return `${TMDB_IMG}h632${pd.profile_path}`;
  } catch (e) {}
  return null;
}

// ─── Question Generators ──────────────────────────────────────────

async function genMoviePosterQ() {
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  let img = await getTextlessPoster(m.id, 'movie');
  if (!img) img = `${TMDB_IMG}w780${m.poster_path}`;
  const wrong = shuffle(cache.movies.filter(x => x.id !== m.id).map(x => x.title)).slice(0, 3);
  return { type: 'movie_poster', category: 'Movie Posters', image: img, revealImage: `${TMDB_IMG}w780${m.poster_path}`,
    answer: m.title, options: shuffle([m.title, ...wrong]), year: m.release_date?.split('-')[0] || '', info: m.title };
}

async function genTVPosterQ() {
  const s = cache.tv[Math.floor(Math.random() * cache.tv.length)];
  let img = await getTextlessPoster(s.id, 'tv');
  if (!img) img = `${TMDB_IMG}w780${s.poster_path}`;
  const wrong = shuffle(cache.tv.filter(x => x.id !== s.id).map(x => x.name)).slice(0, 3);
  return { type: 'tv_poster', category: 'TV Show Posters', image: img, revealImage: `${TMDB_IMG}w780${s.poster_path}`,
    answer: s.name, options: shuffle([s.name, ...wrong]), year: s.first_air_date?.split('-')[0] || '', info: s.name };
}

async function genMovieSceneQ() {
  const entry = questionsDB.movie_scenes[Math.floor(Math.random() * questionsDB.movie_scenes.length)];
  let img = await getSceneStill(entry.tmdb_id, 'movie');
  if (!img) {
    try { const d = await tmdbFetch(`/movie/${entry.tmdb_id}`); if (d.backdrop_path) img = `${TMDB_IMG}w1280${d.backdrop_path}`; } catch (e) {}
  }
  if (!img) img = `${TMDB_IMG}w1280/placeholder.jpg`;
  return { type: 'movie_scene', category: 'Movie Scenes', image: img, revealImage: img,
    answer: entry.title, options: shuffle([entry.title, ...entry.wrong]), year: entry.year, info: entry.title };
}

async function genTVSceneQ() {
  const entry = questionsDB.tv_scenes[Math.floor(Math.random() * questionsDB.tv_scenes.length)];
  let img = await getSceneStill(entry.tmdb_id, 'tv');
  if (!img) {
    try { const d = await tmdbFetch(`/tv/${entry.tmdb_id}`); if (d.backdrop_path) img = `${TMDB_IMG}w1280${d.backdrop_path}`; } catch (e) {}
  }
  if (!img) img = `${TMDB_IMG}w1280/placeholder.jpg`;
  return { type: 'tv_scene', category: 'TV Show Scenes', image: img, revealImage: img,
    answer: entry.title, options: shuffle([entry.title, ...entry.wrong]), year: entry.year, info: entry.title };
}

async function genCharacterQ() {
  const entry = questionsDB.characters[Math.floor(Math.random() * questionsDB.characters.length)];
  let img = await getCharacterImage(entry.tmdb_person_id);
  if (!img) img = `${TMDB_IMG}w780/placeholder.jpg`;
  return { type: 'character', category: 'Guess the Character', image: img, revealImage: img,
    answer: entry.character, options: shuffle([entry.character, ...entry.wrong]),
    year: '', info: `${entry.character} — ${entry.show}` };
}

async function generateRound(type, count = 10) {
  const qs = [], used = new Set();
  const fn = { movie_posters: genMoviePosterQ, tv_posters: genTVPosterQ, movie_scenes: genMovieSceneQ, tv_scenes: genTVSceneQ, characters: genCharacterQ };
  for (let i = 0; i < count; i++) {
    let q, att = 0;
    do { att++; q = await fn[type](); } while (used.has(normalize(q.answer)) && att < 30);
    used.add(normalize(q.answer)); qs.push(q);
    console.log(`  [Q${i + 1}] ${type}: ${q.answer}`);
  }
  return qs;
}

// ─── Difficulty ───────────────────────────────────────────────────
const DIFF = {
  easy: { timer: 45, startBlur: 30, startRadius: 6, blurDecayPower: 1.5 },
  medium: { timer: 50, startBlur: 45, startRadius: 4, blurDecayPower: 1.8 },
  hard: { timer: 60, startBlur: 65, startRadius: 3, blurDecayPower: 2.0 }
};

const LABELS = { movie_posters: 'Movie Posters', tv_posters: 'TV Show Posters', movie_scenes: 'Movie Scenes', tv_scenes: 'TV Show Scenes', characters: 'Guess the Character' };
const ICONS = { movie_posters: '🎬', tv_posters: '📺', movie_scenes: '🎞️', tv_scenes: '📡', characters: '🌟' };

// ─── Socket.IO ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('create-game', async ({ playerName, difficulty, rounds }, cb) => {
    await loadTMDB();
    if (!cache.movies?.length) return cb({ error: 'Cannot load movies. Check TMDB API key.' });

    const code = genCode();
    const diff = DIFF[difficulty] || DIFF.medium;
    const activeRounds = rounds || ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'];

    console.log(`[${code}] Generating questions...`);
    const allQ = {};
    for (const r of activeRounds) allQ[r] = await generateRound(r, 10);
    console.log(`[${code}] Ready!`);

    rooms[code] = { code, masterId: socket.id, masterName: playerName, diff, diffName: difficulty || 'medium',
      activeRounds, allQ, players: {}, hostId: null, state: 'lobby', rIdx: 0, qIdx: 0,
      qStart: null, qTimer: null, answers: {}, created: Date.now() };
    rooms[code].players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: true };
    socket.join(code); socket.roomCode = code;
    cb({ code, rounds: activeRounds });
  });

  socket.on('host-connect', ({ code }, cb) => {
    const r = rooms[code]; if (!r) return cb({ error: 'Room not found. Create game first.' });
    r.hostId = socket.id; socket.join(code); socket.roomCode = code; socket.isHost = true;
    const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
    console.log(`[${code}] TV connected`);
    cb({ ok: true, players: pl, state: r.state });
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
    cb({ ok: true, players: pl });
  });

  socket.on('start-game', (_, cb) => {
    const r = rooms[socket.roomCode]; if (!r || r.masterId !== socket.id) return cb?.({ error: 'Cannot start' });
    r.state = 'round_intro'; r.rIdx = 0; r.qIdx = 0;
    startRound(r); cb?.({ ok: true });
  });

  socket.on('submit-answer', ({ choice }, cb) => {
    const r = rooms[socket.roomCode]; if (!r || r.state !== 'question' || r.answers[socket.id]) return cb?.({ error: 'No' });
    const elapsed = (Date.now() - r.qStart) / 1000;
    const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx];
    const correct = choice === q.answer;
    let pts = 0;
    if (correct) { pts = Math.round(100 + 900 * Math.max(0, 1 - elapsed / r.diff.timer)); if (r.players[socket.id]) r.players[socket.id].score += pts; }
    r.answers[socket.id] = { choice, time: elapsed, correct, points: pts };
    cb?.({ correct, points: pts, answer: q.answer });
    const ac = Object.keys(r.answers).length, tc = Object.values(r.players).filter(p => p.connected).length;
    io.to(r.code).emit('answer-progress', { answered: ac, total: tc });
    if (ac >= tc) { clearTimeout(r.qTimer); setTimeout(() => reveal(r), 500); }
  });

  socket.on('skip-question', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.qTimer); nextQ(r); } });
  socket.on('pause-game', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.qTimer); r.state = 'paused'; io.to(r.code).emit('game-paused'); } });
  socket.on('resume-game', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { r.state = 'question'; const rem = r.diff.timer - ((Date.now() - r.qStart) / 1000); io.to(r.code).emit('game-resumed', { remainingTime: rem }); r.qTimer = setTimeout(() => reveal(r), rem * 1000); } });
  socket.on('end-game-early', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.qTimer); finalResults(r); } });
  socket.on('next-question-request', () => {
    const r = rooms[socket.roomCode]; if (!r || r.masterId !== socket.id) return;
    if (r.state === 'question_reveal') nextQ(r);
    if (r.state === 'round_results') { r.rIdx++; r.qIdx = 0; r.rIdx >= r.activeRounds.length ? finalResults(r) : startRound(r); }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode; if (!code || !rooms[code]) return; const r = rooms[code];
    if (socket.isHost) r.hostId = null;
    else if (r.players[socket.id]) {
      r.players[socket.id].connected = false;
      io.to(code).emit('player-list-update', Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })));
      if (r.state === 'question') { const c = Object.entries(r.players).filter(([, p]) => p.connected); if (c.every(([id]) => r.answers[id]) && c.length > 0) { clearTimeout(r.qTimer); setTimeout(() => reveal(r), 500); } }
    }
    if (Object.values(r.players).filter(p => p.connected).length === 0 && !r.hostId) setTimeout(() => { if (rooms[code] && Object.values(rooms[code].players).filter(p => p.connected).length === 0) delete rooms[code]; }, 300000);
  });
});

// ─── Game Flow ────────────────────────────────────────────────────
function startRound(r) {
  r.state = 'round_intro'; const rt = r.activeRounds[r.rIdx];
  io.to(r.code).emit('round-intro', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundType: rt, roundLabel: LABELS[rt], roundIcon: ICONS[rt], questionsCount: 10, musicTrack: r.rIdx % 4 });
  setTimeout(() => { r.qIdx = 0; sendQ(r); }, 4000);
}

function sendQ(r) {
  r.state = 'question'; r.answers = {};
  const rt = r.activeRounds[r.rIdx], q = r.allQ[rt][r.qIdx];
  r.qStart = Date.now();
  const base = { questionNumber: r.qIdx + 1, totalQuestions: 10, roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, type: q.type, category: q.category, timer: r.diff.timer, options: q.options };
  if (r.hostId) io.to(r.hostId).emit('question-start', { ...base, image: q.image, difficulty: r.diff });
  Object.keys(r.players).forEach(sid => io.to(sid).emit('question-start', base));
  r.qTimer = setTimeout(() => reveal(r), r.diff.timer * 1000);
}

function reveal(r) {
  r.state = 'question_reveal'; clearTimeout(r.qTimer);
  const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx];
  const results = {};
  Object.entries(r.answers).forEach(([sid, a]) => { const p = r.players[sid]; if (p) results[p.name] = a; });
  Object.entries(r.players).forEach(([, p]) => { if (!results[p.name]) results[p.name] = { correct: false, points: 0, time: null, choice: null }; });
  const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score);
  io.to(r.code).emit('question-reveal', { answer: q.answer, info: q.info, year: q.year, image: q.revealImage || q.image, results, leaderboard: pl, questionNumber: r.qIdx + 1, totalQuestions: 10 });
}

function nextQ(r) { r.qIdx++; r.qIdx >= 10 ? roundResults(r) : sendQ(r); }

function roundResults(r) {
  r.state = 'round_results';
  const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score);
  io.to(r.code).emit('round-results', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundLabel: LABELS[r.activeRounds[r.rIdx]], leaderboard: pl, isLastRound: r.rIdx + 1 >= r.activeRounds.length });
}

function finalResults(r) {
  r.state = 'final_results';
  const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score);
  io.to(r.code).emit('final-results', { leaderboard: pl });
}

setInterval(() => { Object.entries(rooms).forEach(([c, r]) => { if (Date.now() - r.created > 5400000) { clearTimeout(r.qTimer); delete rooms[c]; } }); }, 60000);

server.listen(PORT, () => {
  console.log(`\n🎬 Guess The Movie running on port ${PORT}`);
  if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') console.log('⚠️  Set TMDB_API_KEY in .env!\n');
});
