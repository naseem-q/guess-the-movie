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

// ─── In-Memory Store ──────────────────────────────────────────────
const rooms = {};

// ─── Helpers ──────────────────────────────────────────────────────
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

// ─── TMDB Fetching ────────────────────────────────────────────────
const tmdbCache = { movies: null, tvShows: null, people: null, ts: 0 };
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function tmdbFetch(endpoint) {
  const url = `https://api.themoviedb.org/3${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  return res.json();
}

async function fetchMovies() {
  const pages = [1, 2, 3, 4, 5];
  const all = [];
  for (const p of pages) {
    const data = await tmdbFetch(`/movie/popular?page=${p}`);
    all.push(...data.results.filter(m => m.poster_path && m.backdrop_path && m.title));
  }
  return all;
}

async function fetchTVShows() {
  const pages = [1, 2, 3, 4, 5];
  const all = [];
  for (const p of pages) {
    const data = await tmdbFetch(`/tv/popular?page=${p}`);
    all.push(...data.results.filter(t => t.poster_path && t.backdrop_path && t.name));
  }
  return all;
}

async function fetchPeople() {
  const pages = [1, 2, 3];
  const all = [];
  for (const p of pages) {
    const data = await tmdbFetch(`/person/popular?page=${p}`);
    all.push(...data.results.filter(pe => pe.profile_path && pe.name && pe.known_for && pe.known_for.length > 0));
  }
  return all;
}

async function loadTMDBData() {
  if (tmdbCache.movies && (Date.now() - tmdbCache.ts < CACHE_TTL)) return;
  console.log('[TMDB] Fetching fresh data...');
  try {
    const [movies, tvShows, people] = await Promise.all([fetchMovies(), fetchTVShows(), fetchPeople()]);
    tmdbCache.movies = movies;
    tmdbCache.tvShows = tvShows;
    tmdbCache.people = people;
    tmdbCache.ts = Date.now();
    console.log(`[TMDB] Loaded ${movies.length} movies, ${tvShows.length} TV shows, ${people.length} people`);
  } catch (err) {
    console.error('[TMDB] Fetch error:', err.message);
    if (!tmdbCache.movies) {
      tmdbCache.movies = [];
      tmdbCache.tvShows = [];
      tmdbCache.people = [];
    }
  }
}

// ─── Question Generation ──────────────────────────────────────────
function pickWrongOptions(correctTitle, allTitles, count = 3) {
  const normalizedCorrect = normalize(correctTitle);
  const pool = allTitles.filter(t => normalize(t) !== normalizedCorrect);
  return shuffle(pool).slice(0, count);
}

function generateMoviePosterQ(movies) {
  const movie = movies[Math.floor(Math.random() * movies.length)];
  const allTitles = movies.map(m => m.title);
  const wrong = pickWrongOptions(movie.title, allTitles);
  return {
    type: 'movie_poster',
    category: 'Movie Posters',
    image: `${TMDB_IMG}w780${movie.poster_path}`,
    answer: movie.title,
    options: shuffle([movie.title, ...wrong]),
    year: movie.release_date ? movie.release_date.split('-')[0] : '',
    info: movie.title
  };
}

function generateMovieSceneQ(movies) {
  const movie = movies[Math.floor(Math.random() * movies.length)];
  const allTitles = movies.map(m => m.title);
  const wrong = pickWrongOptions(movie.title, allTitles);
  return {
    type: 'movie_scene',
    category: 'Movie Scenes',
    image: `${TMDB_IMG}w1280${movie.backdrop_path}`,
    answer: movie.title,
    options: shuffle([movie.title, ...wrong]),
    year: movie.release_date ? movie.release_date.split('-')[0] : '',
    info: movie.title
  };
}

function generateTVPosterQ(shows) {
  const show = shows[Math.floor(Math.random() * shows.length)];
  const allTitles = shows.map(s => s.name);
  const wrong = pickWrongOptions(show.name, allTitles);
  return {
    type: 'tv_poster',
    category: 'TV Show Posters',
    image: `${TMDB_IMG}w780${show.poster_path}`,
    answer: show.name,
    options: shuffle([show.name, ...wrong]),
    year: show.first_air_date ? show.first_air_date.split('-')[0] : '',
    info: show.name
  };
}

function generateTVSceneQ(shows) {
  const show = shows[Math.floor(Math.random() * shows.length)];
  const allTitles = shows.map(s => s.name);
  const wrong = pickWrongOptions(show.name, allTitles);
  return {
    type: 'tv_scene',
    category: 'TV Show Scenes',
    image: `${TMDB_IMG}w1280${show.backdrop_path}`,
    answer: show.name,
    options: shuffle([show.name, ...wrong]),
    year: show.first_air_date ? show.first_air_date.split('-')[0] : '',
    info: show.name
  };
}

function generateCharacterQ(people) {
  const person = people[Math.floor(Math.random() * people.length)];
  const allNames = people.map(p => p.name);
  const wrong = pickWrongOptions(person.name, allNames);
  const knownFor = person.known_for[0];
  const knownTitle = knownFor ? (knownFor.title || knownFor.name || '') : '';
  return {
    type: 'character',
    category: 'Guess the Character',
    image: `${TMDB_IMG}h632${person.profile_path}`,
    answer: person.name,
    options: shuffle([person.name, ...wrong]),
    year: '',
    info: `${person.name}${knownTitle ? ' — ' + knownTitle : ''}`
  };
}

function generateRoundQuestions(roundType, count = 10) {
  const questions = [];
  const usedAnswers = new Set();

  for (let i = 0; i < count; i++) {
    let q;
    let attempts = 0;
    do {
      attempts++;
      switch (roundType) {
        case 'movie_posters': q = generateMoviePosterQ(tmdbCache.movies); break;
        case 'tv_posters': q = generateTVPosterQ(tmdbCache.tvShows); break;
        case 'movie_scenes': q = generateMovieSceneQ(tmdbCache.movies); break;
        case 'tv_scenes': q = generateTVSceneQ(tmdbCache.tvShows); break;
        case 'characters': q = generateCharacterQ(tmdbCache.people); break;
        default: q = generateMoviePosterQ(tmdbCache.movies);
      }
    } while (usedAnswers.has(normalize(q.answer)) && attempts < 20);

    usedAnswers.add(normalize(q.answer));
    questions.push(q);
  }

  return questions;
}

// ─── Difficulty Settings ──────────────────────────────────────────
const DIFFICULTY = {
  easy: { timer: 45, startBlur: 28, startRadius: 18, blurDecayPower: 1.5 },
  medium: { timer: 50, startBlur: 45, startRadius: 10, blurDecayPower: 1.8 },
  hard: { timer: 60, startBlur: 65, startRadius: 6, blurDecayPower: 2.0 }
};

// ─── Socket.IO ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Create Game ─────────────────────────────────────────────────
  socket.on('create-game', async ({ playerName, difficulty, rounds }, cb) => {
    await loadTMDBData();
    if (!tmdbCache.movies || tmdbCache.movies.length === 0) {
      return cb({ error: 'Could not load movie data. Check your TMDB API key.' });
    }

    const code = genRoomCode();
    const diff = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    const activeRounds = rounds || ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'];

    // Pre-generate all questions
    const allQuestions = {};
    for (const r of activeRounds) {
      allQuestions[r] = generateRoundQuestions(r, 10);
    }

    rooms[code] = {
      code,
      masterId: socket.id,
      masterName: playerName,
      difficulty: diff,
      difficultyName: difficulty || 'medium',
      activeRounds,
      allQuestions,
      players: {},
      hostSocketId: null,
      state: 'lobby',        // lobby | round_intro | question | question_reveal | round_results | final_results
      currentRoundIdx: 0,
      currentQuestionIdx: 0,
      questionStartTime: null,
      questionTimer: null,
      answers: {},            // { socketId: { choice, time } }
      createdAt: Date.now()
    };

    // Add master as a player
    rooms[code].players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: true };

    socket.join(code);
    socket.roomCode = code;

    console.log(`[Room ${code}] Created by ${playerName} | Difficulty: ${difficulty} | Rounds: ${activeRounds.length}`);
    cb({ code, rounds: activeRounds });
  });

  // ── Host Connect (TV) ──────────────────────────────────────────
  socket.on('host-connect', ({ code }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found' });

    room.hostSocketId = socket.id;
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;

    const playerList = Object.values(room.players).map(p => ({
      name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster
    }));

    console.log(`[Room ${code}] Host TV connected`);
    cb({ ok: true, players: playerList, state: room.state, difficulty: room.difficultyName, rounds: room.activeRounds });
  });

  // ── Join Game ──────────────────────────────────────────────────
  socket.on('join-game', ({ code, playerName }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found' });
    if (room.state !== 'lobby') return cb({ error: 'Game already in progress' });
    if (Object.keys(room.players).length >= 8) return cb({ error: 'Room is full (max 8 players)' });

    const names = Object.values(room.players).map(p => p.name.toLowerCase());
    if (names.includes(playerName.toLowerCase())) return cb({ error: 'Name already taken' });

    room.players[socket.id] = { name: playerName, score: 0, connected: true, isMaster: false };
    socket.join(code);
    socket.roomCode = code;

    const playerList = Object.values(room.players).map(p => ({
      name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster
    }));

    io.to(code).emit('player-list-update', playerList);
    console.log(`[Room ${code}] ${playerName} joined (${Object.keys(room.players).length} players)`);
    cb({ ok: true, players: playerList });
  });

  // ── Start Game ─────────────────────────────────────────────────
  socket.on('start-game', (_, cb) => {
    const room = rooms[socket.roomCode];
    if (!room) return cb?.({ error: 'Room not found' });
    if (room.masterId !== socket.id) return cb?.({ error: 'Only the game master can start' });
    if (Object.keys(room.players).length < 1) return cb?.({ error: 'Need at least 1 player' });

    room.state = 'round_intro';
    room.currentRoundIdx = 0;
    room.currentQuestionIdx = 0;

    startRoundIntro(room);
    cb?.({ ok: true });
  });

  // ── Submit Answer ──────────────────────────────────────────────
  socket.on('submit-answer', ({ choice }, cb) => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'question') return cb?.({ error: 'Not in question phase' });
    if (room.answers[socket.id]) return cb?.({ error: 'Already answered' });

    const elapsed = (Date.now() - room.questionStartTime) / 1000;
    const roundType = room.activeRounds[room.currentRoundIdx];
    const question = room.allQuestions[roundType][room.currentQuestionIdx];
    const correct = choice === question.answer;

    let points = 0;
    if (correct) {
      const pct = Math.max(0, 1 - elapsed / room.difficulty.timer);
      points = Math.round(100 + 900 * pct);
      if (room.players[socket.id]) room.players[socket.id].score += points;
    }

    room.answers[socket.id] = { choice, time: elapsed, correct, points };

    // Tell this player their result
    cb?.({ correct, points, answer: question.answer });

    // Tell host someone answered (without revealing if correct, just that they answered)
    const answeredCount = Object.keys(room.answers).length;
    const totalPlayers = Object.values(room.players).filter(p => p.connected).length;
    io.to(room.code).emit('answer-progress', { answered: answeredCount, total: totalPlayers });

    // If all players answered, end question early
    if (answeredCount >= totalPlayers) {
      clearTimeout(room.questionTimer);
      setTimeout(() => revealQuestion(room), 500);
    }
  });

  // ── Host Controls ──────────────────────────────────────────────
  socket.on('skip-question', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.masterId !== socket.id) return;
    clearTimeout(room.questionTimer);
    nextQuestion(room);
  });

  socket.on('pause-game', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.masterId !== socket.id) return;
    clearTimeout(room.questionTimer);
    room.state = 'paused';
    io.to(room.code).emit('game-paused');
  });

  socket.on('resume-game', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.masterId !== socket.id) return;
    room.state = 'question';
    const remaining = room.difficulty.timer - ((Date.now() - room.questionStartTime) / 1000);
    io.to(room.code).emit('game-resumed', { remainingTime: remaining });
    room.questionTimer = setTimeout(() => revealQuestion(room), remaining * 1000);
  });

  socket.on('end-game-early', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.masterId !== socket.id) return;
    clearTimeout(room.questionTimer);
    showFinalResults(room);
  });

  socket.on('next-question-request', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.masterId !== socket.id) return;
    if (room.state === 'question_reveal') nextQuestion(room);
    if (room.state === 'round_results') {
      room.currentRoundIdx++;
      room.currentQuestionIdx = 0;
      if (room.currentRoundIdx >= room.activeRounds.length) {
        showFinalResults(room);
      } else {
        startRoundIntro(room);
      }
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (socket.isHost) {
      room.hostSocketId = null;
      console.log(`[Room ${code}] Host TV disconnected`);
    } else if (room.players[socket.id]) {
      room.players[socket.id].connected = false;
      const playerList = Object.values(room.players).map(p => ({
        name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster
      }));
      io.to(code).emit('player-list-update', playerList);
      console.log(`[Room ${code}] ${room.players[socket.id].name} disconnected`);

      // Check if all connected players have answered
      if (room.state === 'question') {
        const connected = Object.entries(room.players).filter(([, p]) => p.connected);
        const allAnswered = connected.every(([id]) => room.answers[id]);
        if (allAnswered && connected.length > 0) {
          clearTimeout(room.questionTimer);
          setTimeout(() => revealQuestion(room), 500);
        }
      }
    }

    // Cleanup empty rooms after 5 minutes
    const connectedCount = Object.values(room.players).filter(p => p.connected).length;
    if (connectedCount === 0 && !room.hostSocketId) {
      setTimeout(() => {
        if (rooms[code] && Object.values(rooms[code].players).filter(p => p.connected).length === 0) {
          delete rooms[code];
          console.log(`[Room ${code}] Deleted (empty)`);
        }
      }, 5 * 60 * 1000);
    }
  });
});

// ─── Game Flow Functions ──────────────────────────────────────────
function startRoundIntro(room) {
  room.state = 'round_intro';
  const roundType = room.activeRounds[room.currentRoundIdx];
  const roundLabels = {
    movie_posters: 'Movie Posters',
    tv_posters: 'TV Show Posters',
    movie_scenes: 'Movie Scenes',
    tv_scenes: 'TV Show Scenes',
    characters: 'Guess the Character'
  };
  const roundIcons = {
    movie_posters: '🎬',
    tv_posters: '📺',
    movie_scenes: '🎞️',
    tv_scenes: '📡',
    characters: '🌟'
  };

  io.to(room.code).emit('round-intro', {
    roundNumber: room.currentRoundIdx + 1,
    totalRounds: room.activeRounds.length,
    roundType,
    roundLabel: roundLabels[roundType] || roundType,
    roundIcon: roundIcons[roundType] || '🎬',
    questionsCount: 10
  });

  // Auto-start first question after 4 seconds
  setTimeout(() => {
    room.currentQuestionIdx = 0;
    sendQuestion(room);
  }, 4000);
}

function sendQuestion(room) {
  room.state = 'question';
  room.answers = {};

  const roundType = room.activeRounds[room.currentRoundIdx];
  const question = room.allQuestions[roundType][room.currentQuestionIdx];

  room.questionStartTime = Date.now();

  // Send to host (TV) - image + metadata, no answer
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('question-start', {
      questionNumber: room.currentQuestionIdx + 1,
      totalQuestions: 10,
      roundNumber: room.currentRoundIdx + 1,
      totalRounds: room.activeRounds.length,
      image: question.image,
      type: question.type,
      category: question.category,
      timer: room.difficulty.timer,
      difficulty: room.difficulty,
      options: question.options
    });
  }

  // Send to players - options but no image (they look at TV)
  Object.keys(room.players).forEach(sid => {
    io.to(sid).emit('question-start', {
      questionNumber: room.currentQuestionIdx + 1,
      totalQuestions: 10,
      roundNumber: room.currentRoundIdx + 1,
      totalRounds: room.activeRounds.length,
      type: question.type,
      category: question.category,
      timer: room.difficulty.timer,
      options: question.options
    });
  });

  // Timer
  room.questionTimer = setTimeout(() => revealQuestion(room), room.difficulty.timer * 1000);
}

function revealQuestion(room) {
  room.state = 'question_reveal';
  clearTimeout(room.questionTimer);

  const roundType = room.activeRounds[room.currentRoundIdx];
  const question = room.allQuestions[roundType][room.currentQuestionIdx];

  const results = {};
  Object.entries(room.answers).forEach(([sid, ans]) => {
    const player = room.players[sid];
    if (player) results[player.name] = { correct: ans.correct, points: ans.points, time: ans.time, choice: ans.choice };
  });

  // Also add players who didn't answer
  Object.entries(room.players).forEach(([sid, player]) => {
    if (!results[player.name]) {
      results[player.name] = { correct: false, points: 0, time: null, choice: null };
    }
  });

  const playerList = Object.values(room.players).map(p => ({
    name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster
  })).sort((a, b) => b.score - a.score);

  io.to(room.code).emit('question-reveal', {
    answer: question.answer,
    info: question.info,
    year: question.year,
    image: question.image,
    results,
    leaderboard: playerList,
    questionNumber: room.currentQuestionIdx + 1,
    totalQuestions: 10
  });
}

function nextQuestion(room) {
  room.currentQuestionIdx++;
  if (room.currentQuestionIdx >= 10) {
    showRoundResults(room);
  } else {
    sendQuestion(room);
  }
}

function showRoundResults(room) {
  room.state = 'round_results';
  const roundType = room.activeRounds[room.currentRoundIdx];
  const roundLabels = {
    movie_posters: 'Movie Posters',
    tv_posters: 'TV Show Posters',
    movie_scenes: 'Movie Scenes',
    tv_scenes: 'TV Show Scenes',
    characters: 'Guess the Character'
  };

  const playerList = Object.values(room.players).map(p => ({
    name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster
  })).sort((a, b) => b.score - a.score);

  io.to(room.code).emit('round-results', {
    roundNumber: room.currentRoundIdx + 1,
    totalRounds: room.activeRounds.length,
    roundLabel: roundLabels[roundType] || roundType,
    leaderboard: playerList,
    isLastRound: room.currentRoundIdx + 1 >= room.activeRounds.length
  });
}

function showFinalResults(room) {
  room.state = 'final_results';

  const playerList = Object.values(room.players).map(p => ({
    name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster
  })).sort((a, b) => b.score - a.score);

  io.to(room.code).emit('final-results', { leaderboard: playerList });
}

// ─── Room Cleanup ─────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  Object.entries(rooms).forEach(([code, room]) => {
    if (now - room.createdAt > 1000 * 60 * 90) { // 90 min max
      clearTimeout(room.questionTimer);
      delete rooms[code];
      console.log(`[Room ${code}] Expired`);
    }
  });
}, 60000);

// ─── Start ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎬 Guess The Movie is running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-ip>:${PORT}\n`);
  if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') {
    console.log('   ⚠️  No TMDB API key set! Add it to .env file.\n');
  }
});
