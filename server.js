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

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(s) {
  return s.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]/g, '');
}

async function tmdbFetch(endpoint) {
  const url = `https://api.themoviedb.org/3${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

// ─── TMDB Data Loading ────────────────────────────────────────────
const tmdbCache = { movies: null, tvShows: null, people: null, ts: 0 };
const CACHE_TTL = 3600000;

async function fetchAll(endpoint, pages) {
  const all = [];
  for (const p of pages) {
    try {
      const data = await tmdbFetch(`${endpoint}?page=${p}`);
      all.push(...(data.results || []));
    } catch (e) { console.error(`[TMDB] Page ${p} error:`, e.message); }
  }
  return all;
}

async function loadTMDBData() {
  if (tmdbCache.movies && (Date.now() - tmdbCache.ts < CACHE_TTL)) return;
  console.log('[TMDB] Fetching fresh data...');
  try {
    const [movies, tvShows, people] = await Promise.all([
      fetchAll('/movie/popular', [1, 2, 3, 4, 5]),
      fetchAll('/tv/popular', [1, 2, 3, 4, 5]),
      fetchAll('/person/popular', [1, 2, 3])
    ]);
    tmdbCache.movies = movies.filter(m => m.poster_path && m.backdrop_path && m.title);
    tmdbCache.tvShows = tvShows.filter(t => t.poster_path && t.backdrop_path && t.name);
    tmdbCache.people = people.filter(p => p.profile_path && p.name && p.known_for?.length > 0 && p.gender);
    tmdbCache.ts = Date.now();
    console.log(`[TMDB] Loaded ${tmdbCache.movies.length} movies, ${tmdbCache.tvShows.length} TV, ${tmdbCache.people.length} people`);
  } catch (err) {
    console.error('[TMDB] Error:', err.message);
    if (!tmdbCache.movies) { tmdbCache.movies = []; tmdbCache.tvShows = []; tmdbCache.people = []; }
  }
}

// ─── Image Fetching (Alternative posters, stills, character images) ─
async function getAlternativePoster(id, type) {
  try {
    const data = await tmdbFetch(`/${type}/${id}/images?include_image_language=en,null`);
    const alts = (data.posters || []).slice(1).filter(p => p.file_path);
    if (alts.length > 0) return `${TMDB_IMG}w780${alts[Math.floor(Math.random() * Math.min(alts.length, 5))].file_path}`;
  } catch (e) {}
  return null;
}

async function getSceneStill(id, type) {
  try {
    const data = await tmdbFetch(`/${type}/${id}/images?include_image_language=en,null`);
    const bds = (data.backdrops || []).slice(1);
    if (bds.length > 0) return `${TMDB_IMG}w1280${bds[Math.floor(Math.random() * Math.min(bds.length, 8))].file_path}`;
  } catch (e) {}
  return null;
}

async function getCharacterImage(personId) {
  try {
    const data = await tmdbFetch(`/person/${personId}/tagged_images`);
    const stills = (data.results || []).filter(i => i.media_type === 'movie' || i.media_type === 'tv');
    if (stills.length > 0) return `${TMDB_IMG}w780${stills[Math.floor(Math.random() * Math.min(stills.length, 5))].file_path}`;
  } catch (e) {}
  return null;
}

async function getCharacterName(personId) {
  try {
    const credits = await tmdbFetch(`/person/${personId}/combined_credits`);
    if (credits.cast?.length > 0) {
      const top = credits.cast.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
      if (top?.character?.length > 0) return top.character;
    }
  } catch (e) {}
  return null;
}

// ─── Question Generators ──────────────────────────────────────────
function pickWrong(correct, allTitles, count = 3) {
  const nc = normalize(correct);
  return shuffle(allTitles.filter(t => normalize(t) !== nc)).slice(0, count);
}

function pickGenderWrong(correctName, gender, people, count = 3) {
  const nc = normalize(correctName);
  return shuffle(people.filter(p => p.gender === gender && normalize(p.name) !== nc).map(p => p.name)).slice(0, count);
}

async function genMoviePosterQ(movies) {
  const m = movies[Math.floor(Math.random() * movies.length)];
  let img = await getAlternativePoster(m.id, 'movie');
  if (!img) img = `${TMDB_IMG}w780${m.poster_path}`;
  return {
    type: 'movie_poster', category: 'Movie Posters', image: img,
    revealImage: `${TMDB_IMG}w780${m.poster_path}`,
    answer: m.title, options: shuffle([m.title, ...pickWrong(m.title, movies.map(x => x.title))]),
    year: m.release_date?.split('-')[0] || '', info: m.title
  };
}

async function genTVPosterQ(shows) {
  const s = shows[Math.floor(Math.random() * shows.length)];
  let img = await getAlternativePoster(s.id, 'tv');
  if (!img) img = `${TMDB_IMG}w780${s.poster_path}`;
  return {
    type: 'tv_poster', category: 'TV Show Posters', image: img,
    revealImage: `${TMDB_IMG}w780${s.poster_path}`,
    answer: s.name, options: shuffle([s.name, ...pickWrong(s.name, shows.map(x => x.name))]),
    year: s.first_air_date?.split('-')[0] || '', info: s.name
  };
}

async function genMovieSceneQ(movies) {
  const m = movies[Math.floor(Math.random() * movies.length)];
  let img = await getSceneStill(m.id, 'movie');
  if (!img) img = `${TMDB_IMG}w1280${m.backdrop_path}`;
  return {
    type: 'movie_scene', category: 'Movie Scenes', image: img, revealImage: img,
    answer: m.title, options: shuffle([m.title, ...pickWrong(m.title, movies.map(x => x.title))]),
    year: m.release_date?.split('-')[0] || '', info: m.title
  };
}

async function genTVSceneQ(shows) {
  const s = shows[Math.floor(Math.random() * shows.length)];
  let img = await getSceneStill(s.id, 'tv');
  if (!img) img = `${TMDB_IMG}w1280${s.backdrop_path}`;
  return {
    type: 'tv_scene', category: 'TV Show Scenes', image: img, revealImage: img,
    answer: s.name, options: shuffle([s.name, ...pickWrong(s.name, shows.map(x => x.name))]),
    year: s.first_air_date?.split('-')[0] || '', info: s.name
  };
}

async function genCharacterQ(people) {
  const p = people[Math.floor(Math.random() * people.length)];
  let img = await getCharacterImage(p.id);
  if (!img) img = `${TMDB_IMG}h632${p.profile_path}`;

  const charName = await getCharacterName(p.id);
  if (charName) {
    // Get gender-matched character names for wrong options
    const wrongChars = [];
    const sameg = shuffle(people.filter(x => x.gender === p.gender && normalize(x.name) !== normalize(p.name)));
    for (const op of sameg.slice(0, 10)) {
      const cn = await getCharacterName(op.id);
      if (cn && normalize(cn) !== normalize(charName)) { wrongChars.push(cn); if (wrongChars.length >= 3) break; }
    }
    if (wrongChars.length >= 3) {
      return {
        type: 'character', category: 'Guess the Character', image: img, revealImage: img,
        answer: charName, options: shuffle([charName, ...wrongChars.slice(0, 3)]),
        year: '', info: `${charName} (${p.name})`
      };
    }
  }

  const knownTitle = p.known_for[0]?.title || p.known_for[0]?.name || '';
  return {
    type: 'character', category: 'Guess the Character', image: img, revealImage: img,
    answer: p.name, options: shuffle([p.name, ...pickGenderWrong(p.name, p.gender, people)]),
    year: '', info: `${p.name}${knownTitle ? ' — ' + knownTitle : ''}`
  };
}

async function generateRoundQuestions(roundType, count = 10) {
  const qs = [], used = new Set();
  const genFn = { movie_posters: genMoviePosterQ, tv_posters: genTVPosterQ, movie_scenes: genMovieSceneQ, tv_scenes: genTVSceneQ, characters: genCharacterQ };
  const src = { movie_posters: tmdbCache.movies, tv_posters: tmdbCache.tvShows, movie_scenes: tmdbCache.movies, tv_scenes: tmdbCache.tvShows, characters: tmdbCache.people };

  for (let i = 0; i < count; i++) {
    let q, att = 0;
    do { att++; q = await genFn[roundType](src[roundType]); } while (used.has(normalize(q.answer)) && att < 20);
    used.add(normalize(q.answer));
    qs.push(q);
    console.log(`[Q] ${roundType} ${i + 1}: ${q.answer}`);
  }
  return qs;
}

// ─── Difficulty ───────────────────────────────────────────────────
const DIFFICULTY = {
  easy: { timer: 45, startBlur: 30, startRadius: 5, blurDecayPower: 1.5 },
  medium: { timer: 50, startBlur: 45, startRadius: 4, blurDecayPower: 1.8 },
  hard: { timer: 60, startBlur: 65, startRadius: 3, blurDecayPower: 2.0 }
};

// ─── Socket.IO ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('create-game', async ({ playerName, difficulty, rounds }, cb) => {
    await loadTMDBData();
    if (!tmdbCache.movies?.length) return cb({ error: 'Could not load movie data. Check TMDB API key.' });

    const code = genRoomCode();
    const diff = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    const activeRounds = rounds || ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'];

    console.log(`[Room ${code}] Generating questions...`);
    const allQuestions = {};
    for (const r of activeRounds) { allQuestions[r] = await generateRoundQuestions(r, 10); }
    console.log(`[Room ${code}] Ready!`);

    rooms[code] = {
      code, masterId: socket.id, masterName: playerName, difficulty: diff,
      difficultyName: difficulty || 'medium', activeRounds, allQuestions,
      players: {}, hostSocketId: null, state: 'lobby',
      currentRoundIdx: 0, currentQuestionIdx: 0,
      questionStartTime: null, questionTimer: null, answers: {},
      createdAt: Date.now()
    };

    rooms[code].players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: true };
    socket.join(code);
    socket.roomCode = code;
    console.log(`[Room ${code}] Created by ${playerName}`);
    cb({ code, rounds: activeRounds });
  });

  socket.on('host-connect', ({ code }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found. Create a game first.' });
    room.hostSocketId = socket.id;
    socket.join(code); socket.roomCode = code; socket.isHost = true;
    const pl = Object.values(room.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
    console.log(`[Room ${code}] TV connected`);
    cb({ ok: true, players: pl, state: room.state, difficulty: room.difficultyName, rounds: room.activeRounds });
  });

  socket.on('join-game', ({ code, playerName }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found' });
    if (room.state !== 'lobby') return cb({ error: 'Game already started' });
    if (Object.keys(room.players).length >= 8) return cb({ error: 'Room full' });
    const names = Object.values(room.players).map(p => p.name.toLowerCase());
    if (names.includes(playerName.toLowerCase())) return cb({ error: 'Name taken' });

    room.players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: false };
    socket.join(code); socket.roomCode = code;
    const pl = Object.values(room.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
    io.to(code).emit('player-list-update', pl);
    console.log(`[Room ${code}] ${playerName} joined`);
    cb({ ok: true, players: pl });
  });

  socket.on('start-game', (_, cb) => {
    const room = rooms[socket.roomCode];
    if (!room) return cb?.({ error: 'No room' });
    if (room.masterId !== socket.id) return cb?.({ error: 'Only master can start' });
    room.state = 'round_intro'; room.currentRoundIdx = 0; room.currentQuestionIdx = 0;
    startRoundIntro(room);
    cb?.({ ok: true });
  });

  socket.on('submit-answer', ({ choice }, cb) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'question') return cb?.({ error: 'Not in question' });
    if (room.answers[socket.id]) return cb?.({ error: 'Already answered' });

    const elapsed = (Date.now() - room.questionStartTime) / 1000;
    const rt = room.activeRounds[room.currentRoundIdx];
    const q = room.allQuestions[rt][room.currentQuestionIdx];
    const correct = choice === q.answer;
    let points = 0;
    if (correct) { const pct = Math.max(0, 1 - elapsed / room.difficulty.timer); points = Math.round(100 + 900 * pct); if (room.players[socket.id]) room.players[socket.id].score += points; }
    room.answers[socket.id] = { choice, time: elapsed, correct, points };
    cb?.({ correct, points, answer: q.answer });

    const ac = Object.keys(room.answers).length;
    const tc = Object.values(room.players).filter(p => p.connected).length;
    io.to(room.code).emit('answer-progress', { answered: ac, total: tc });
    if (ac >= tc) { clearTimeout(room.questionTimer); setTimeout(() => revealQuestion(room), 500); }
  });

  socket.on('skip-question', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.questionTimer); nextQuestion(r); } });
  socket.on('pause-game', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.questionTimer); r.state = 'paused'; io.to(r.code).emit('game-paused'); } });
  socket.on('resume-game', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { r.state = 'question'; const rem = r.difficulty.timer - ((Date.now() - r.questionStartTime) / 1000); io.to(r.code).emit('game-resumed', { remainingTime: rem }); r.questionTimer = setTimeout(() => revealQuestion(r), rem * 1000); } });
  socket.on('end-game-early', () => { const r = rooms[socket.roomCode]; if (r?.masterId === socket.id) { clearTimeout(r.questionTimer); showFinalResults(r); } });
  socket.on('next-question-request', () => {
    const r = rooms[socket.roomCode]; if (!r || r.masterId !== socket.id) return;
    if (r.state === 'question_reveal') nextQuestion(r);
    if (r.state === 'round_results') { r.currentRoundIdx++; r.currentQuestionIdx = 0; if (r.currentRoundIdx >= r.activeRounds.length) showFinalResults(r); else startRoundIntro(r); }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode; if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (socket.isHost) { room.hostSocketId = null; }
    else if (room.players[socket.id]) {
      room.players[socket.id].connected = false;
      const pl = Object.values(room.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
      io.to(code).emit('player-list-update', pl);
      if (room.state === 'question') {
        const conn = Object.entries(room.players).filter(([, p]) => p.connected);
        if (conn.every(([id]) => room.answers[id]) && conn.length > 0) { clearTimeout(room.questionTimer); setTimeout(() => revealQuestion(room), 500); }
      }
    }
    const cc = Object.values(room.players).filter(p => p.connected).length;
    if (cc === 0 && !room.hostSocketId) setTimeout(() => { if (rooms[code] && Object.values(rooms[code].players).filter(p => p.connected).length === 0) { delete rooms[code]; } }, 300000);
  });
});

// ─── Game Flow ────────────────────────────────────────────────────
const ROUND_LABELS = { movie_posters: 'Movie Posters', tv_posters: 'TV Show Posters', movie_scenes: 'Movie Scenes', tv_scenes: 'TV Show Scenes', characters: 'Guess the Character' };
const ROUND_ICONS = { movie_posters: '🎬', tv_posters: '📺', movie_scenes: '🎞️', tv_scenes: '📡', characters: '🌟' };
const ROUND_MUSIC = { movie_posters: 0, tv_posters: 1, movie_scenes: 2, tv_scenes: 3, characters: 0 };

function startRoundIntro(room) {
  room.state = 'round_intro';
  const rt = room.activeRounds[room.currentRoundIdx];
  io.to(room.code).emit('round-intro', {
    roundNumber: room.currentRoundIdx + 1, totalRounds: room.activeRounds.length,
    roundType: rt, roundLabel: ROUND_LABELS[rt], roundIcon: ROUND_ICONS[rt],
    questionsCount: 10, musicTrack: ROUND_MUSIC[rt] || 0
  });
  setTimeout(() => { room.currentQuestionIdx = 0; sendQuestion(room); }, 4000);
}

function sendQuestion(room) {
  room.state = 'question'; room.answers = {};
  const rt = room.activeRounds[room.currentRoundIdx];
  const q = room.allQuestions[rt][room.currentQuestionIdx];
  room.questionStartTime = Date.now();

  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('question-start', {
      questionNumber: room.currentQuestionIdx + 1, totalQuestions: 10,
      roundNumber: room.currentRoundIdx + 1, totalRounds: room.activeRounds.length,
      image: q.image, type: q.type, category: q.category,
      timer: room.difficulty.timer, difficulty: room.difficulty, options: q.options
    });
  }
  Object.keys(room.players).forEach(sid => {
    io.to(sid).emit('question-start', {
      questionNumber: room.currentQuestionIdx + 1, totalQuestions: 10,
      roundNumber: room.currentRoundIdx + 1, totalRounds: room.activeRounds.length,
      type: q.type, category: q.category, timer: room.difficulty.timer, options: q.options
    });
  });
  room.questionTimer = setTimeout(() => revealQuestion(room), room.difficulty.timer * 1000);
}

function revealQuestion(room) {
  room.state = 'question_reveal'; clearTimeout(room.questionTimer);
  const rt = room.activeRounds[room.currentRoundIdx];
  const q = room.allQuestions[rt][room.currentQuestionIdx];
  const results = {};
  Object.entries(room.answers).forEach(([sid, a]) => { const p = room.players[sid]; if (p) results[p.name] = { correct: a.correct, points: a.points, time: a.time, choice: a.choice }; });
  Object.entries(room.players).forEach(([sid, p]) => { if (!results[p.name]) results[p.name] = { correct: false, points: 0, time: null, choice: null }; });
  const pl = Object.values(room.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score);
  io.to(room.code).emit('question-reveal', { answer: q.answer, info: q.info, year: q.year, image: q.revealImage || q.image, results, leaderboard: pl, questionNumber: room.currentQuestionIdx + 1, totalQuestions: 10 });
}

function nextQuestion(room) { room.currentQuestionIdx++; if (room.currentQuestionIdx >= 10) showRoundResults(room); else sendQuestion(room); }

function showRoundResults(room) {
  room.state = 'round_results';
  const rt = room.activeRounds[room.currentRoundIdx];
  const pl = Object.values(room.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score);
  io.to(room.code).emit('round-results', { roundNumber: room.currentRoundIdx + 1, totalRounds: room.activeRounds.length, roundLabel: ROUND_LABELS[rt], leaderboard: pl, isLastRound: room.currentRoundIdx + 1 >= room.activeRounds.length });
}

function showFinalResults(room) {
  room.state = 'final_results';
  const pl = Object.values(room.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score);
  io.to(room.code).emit('final-results', { leaderboard: pl });
}

setInterval(() => { const now = Date.now(); Object.entries(rooms).forEach(([code, room]) => { if (now - room.createdAt > 5400000) { clearTimeout(room.questionTimer); delete rooms[code]; } }); }, 60000);

server.listen(PORT, () => {
  console.log(`\n🎬 Guess The Movie is running on port ${PORT}`);
  if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') console.log('   ⚠️  No TMDB API key!\n');
});
