// ─── Party Game Audio System ──────────────────────────────────────
// Exciting game-show style music and sound effects
// Uses Web Audio API - no external files needed

window.GameAudio = (function() {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let muted = false;
  let musicPlaying = false;
  let musicTimeout = null;
  let currentTrack = 0;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.15;
    musicGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.4;
    sfxGain.connect(masterGain);
  }

  function ensureCtx() {
    init();
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ─── Basic Sound Primitives ─────────────────────────
  function tone(freq, start, dur, type, gain, target) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2000;
    o.connect(f);
    f.connect(g);
    g.connect(target || sfxGain);
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain || 0.1, start + 0.02);
    g.gain.setValueAtTime(gain || 0.1, start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function chord(notes, start, dur, type, gain, target) {
    notes.forEach(n => tone(n, start, dur, type, (gain || 0.06) / notes.length, target));
  }

  function noise(start, dur, gain) {
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 8000; f.Q.value = 0.5;
    src.buffer = buf;
    src.connect(f); f.connect(g); g.connect(sfxGain);
    g.gain.setValueAtTime(gain || 0.05, start);
    g.gain.linearRampToValueAtTime(0, start + dur);
    src.start(start); src.stop(start + dur + 0.01);
  }

  // ─── SOUND EFFECTS ──────────────────────────────────

  // Countdown tick (last 5 seconds)
  function tickSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    tone(1200, t, 0.06, 'square', 0.06);
  }

  // Correct answer - triumphant ascending arpeggio
  function correctSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) => {
      tone(n, t + i * 0.08, 0.25, 'sine', 0.12);
      tone(n * 0.5, t + i * 0.08, 0.2, 'triangle', 0.06);
    });
    // Shimmer
    for (let i = 0; i < 3; i++) {
      noise(t + 0.1 + i * 0.15, 0.15, 0.03);
    }
  }

  // Wrong answer - descending buzz
  function wrongSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    tone(300, t, 0.15, 'sawtooth', 0.08);
    tone(200, t + 0.12, 0.2, 'sawtooth', 0.06);
  }

  // Time's up - dramatic buzzer
  function timeUpSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    tone(220, t, 0.5, 'sawtooth', 0.1);
    tone(185, t + 0.05, 0.5, 'sawtooth', 0.08);
    tone(165, t + 0.1, 0.5, 'square', 0.06);
  }

  // Question reveal - dramatic reveal stinger
  function revealSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    // Dramatic sweep up
    const sweep = [262, 330, 392, 523, 659, 784];
    sweep.forEach((n, i) => {
      tone(n, t + i * 0.06, 0.3, 'sine', 0.08);
    });
    // Big chord at end
    chord([523, 659, 784, 1047], t + 0.4, 0.8, 'sine', 0.15);
    chord([262, 330, 392, 523], t + 0.4, 0.8, 'triangle', 0.08);
  }

  // Round start - exciting fanfare
  function roundStartSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    // Trumpet-like fanfare
    const fanfare = [
      [392, 0, 0.15], [392, 0.15, 0.15], [523, 0.3, 0.15],
      [659, 0.5, 0.2], [784, 0.75, 0.4]
    ];
    fanfare.forEach(([n, off, dur]) => {
      tone(n, t + off, dur, 'sawtooth', 0.06);
      tone(n, t + off, dur, 'square', 0.04);
    });
    // Drum roll
    for (let i = 0; i < 8; i++) {
      noise(t + i * 0.1, 0.08, 0.04);
    }
  }

  // Round complete - celebration with applause
  function roundCompleteSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    // Victory chord progression
    chord([523, 659, 784], t, 0.3, 'sine', 0.12);
    chord([587, 740, 880], t + 0.3, 0.3, 'sine', 0.12);
    chord([659, 784, 1047], t + 0.6, 0.5, 'sine', 0.15);
    chord([523, 659, 784, 1047], t + 1.1, 0.8, 'triangle', 0.1);

    // Applause (filtered noise bursts)
    for (let i = 0; i < 30; i++) {
      const start = t + 0.5 + Math.random() * 2;
      noise(start, 0.03 + Math.random() * 0.05, 0.02 + Math.random() * 0.03);
    }
  }

  // Winner celebration - big dramatic finale
  function winnerSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    // Epic ascending chords
    const chords = [
      [[392, 494, 587], 0], [[440, 554, 659], 0.4],
      [[494, 622, 740], 0.8], [[523, 659, 784, 1047], 1.2]
    ];
    chords.forEach(([notes, off]) => {
      chord(notes, t + off, 0.5, 'sine', 0.15);
      chord(notes, t + off, 0.5, 'triangle', 0.08);
    });

    // Sparkle effects
    for (let i = 0; i < 10; i++) {
      tone(1500 + Math.random() * 2000, t + 1.5 + i * 0.1, 0.15, 'sine', 0.04);
    }

    // Big applause
    for (let i = 0; i < 50; i++) {
      noise(t + 1.0 + Math.random() * 3, 0.03 + Math.random() * 0.06, 0.015 + Math.random() * 0.02);
    }
  }

  // Player joined
  function playerJoinSound() {
    if (muted) return; ensureCtx();
    const t = ctx.currentTime;
    tone(880, t, 0.1, 'sine', 0.08);
    tone(1047, t + 0.08, 0.15, 'sine', 0.1);
  }

  // ─── BACKGROUND MUSIC ──────────────────────────────
  // Four different exciting party game loops

  // Track 0: Upbeat game show (Movie Posters)
  function playTrack0() {
    if (!musicPlaying || muted) return;
    const t = ctx.currentTime;
    const bpm = 130;
    const beat = 60 / bpm;

    // Driving bass line
    const bassNotes = [130.8, 146.8, 164.8, 146.8, 130.8, 146.8, 174.6, 146.8];
    bassNotes.forEach((n, i) => {
      tone(n, t + i * beat, beat * 0.8, 'triangle', 0.12, musicGain);
    });

    // Synth stabs (game show feel)
    const stabs = [[0, [523, 659, 784]], [2, [587, 740, 880]], [4, [523, 659, 784]], [6, [494, 622, 784]]];
    stabs.forEach(([b, notes]) => {
      chord(notes, t + b * beat, beat * 0.5, 'square', 0.06, musicGain);
    });

    // Hi-hat pattern
    for (let i = 0; i < 16; i++) {
      noise(t + i * beat * 0.5, 0.03, i % 2 === 0 ? 0.03 : 0.015);
    }

    // Kick-like bass hits
    [0, 2, 4, 6].forEach(b => {
      tone(60, t + b * beat, 0.15, 'sine', 0.1, musicGain);
    });

    const loopDur = bassNotes.length * beat;
    musicTimeout = setTimeout(() => { if (musicPlaying) playTrack0(); }, loopDur * 1000);
  }

  // Track 1: Funky groove (TV Shows)
  function playTrack1() {
    if (!musicPlaying || muted) return;
    const t = ctx.currentTime;
    const bpm = 115;
    const beat = 60 / bpm;

    // Funky bass
    const bass = [98, 0, 98, 110, 0, 130.8, 0, 110];
    bass.forEach((n, i) => {
      if (n > 0) tone(n, t + i * beat, beat * 0.6, 'sawtooth', 0.08, musicGain);
    });

    // Rhodes-like chords
    chord([330, 415, 523], t, beat * 2, 'sine', 0.05, musicGain);
    chord([349, 440, 554], t + beat * 2, beat * 2, 'sine', 0.05, musicGain);
    chord([294, 370, 466], t + beat * 4, beat * 2, 'sine', 0.05, musicGain);
    chord([330, 415, 523], t + beat * 6, beat * 2, 'sine', 0.05, musicGain);

    // Snappy rhythm
    [0, 2, 4, 6].forEach(b => noise(t + (b + 1) * beat, 0.05, 0.04));

    musicTimeout = setTimeout(() => { if (musicPlaying) playTrack1(); }, 8 * beat * 1000);
  }

  // Track 2: Dramatic tension (Movie Scenes)
  function playTrack2() {
    if (!musicPlaying || muted) return;
    const t = ctx.currentTime;
    const bpm = 100;
    const beat = 60 / bpm;

    // Deep pulsing bass
    for (let i = 0; i < 8; i++) {
      tone(65.4, t + i * beat, beat * 0.4, 'sine', 0.12, musicGain);
      tone(65.4, t + i * beat, beat * 0.4, 'triangle', 0.06, musicGain);
    }

    // Mysterious pad
    chord([196, 233, 294, 349], t, beat * 4, 'sine', 0.04, musicGain);
    chord([185, 220, 277, 330], t + beat * 4, beat * 4, 'sine', 0.04, musicGain);

    // Cinematic hits
    [0, 3, 6].forEach(b => {
      tone(98, t + b * beat, 0.3, 'sawtooth', 0.06, musicGain);
    });

    // Tension strings
    tone(440, t + beat * 2, beat * 2, 'sawtooth', 0.02, musicGain);
    tone(466, t + beat * 6, beat * 2, 'sawtooth', 0.02, musicGain);

    musicTimeout = setTimeout(() => { if (musicPlaying) playTrack2(); }, 8 * beat * 1000);
  }

  // Track 3: Energetic electronic (Characters / TV Scenes)
  function playTrack3() {
    if (!musicPlaying || muted) return;
    const t = ctx.currentTime;
    const bpm = 140;
    const beat = 60 / bpm;

    // Pumping bass
    for (let i = 0; i < 8; i++) {
      tone(55 + (i % 2) * 10, t + i * beat, beat * 0.3, 'sine', 0.15, musicGain);
    }

    // Arpeggiated synth
    const arp = [523, 659, 784, 1047, 784, 659, 523, 392];
    arp.forEach((n, i) => {
      tone(n, t + i * beat, beat * 0.4, 'square', 0.03, musicGain);
    });

    // Driving hi-hats
    for (let i = 0; i < 16; i++) {
      noise(t + i * beat * 0.5, 0.02, 0.025);
    }

    // Power chord stabs
    chord([196, 294, 392], t, beat * 0.3, 'sawtooth', 0.06, musicGain);
    chord([220, 330, 440], t + beat * 4, beat * 0.3, 'sawtooth', 0.06, musicGain);

    musicTimeout = setTimeout(() => { if (musicPlaying) playTrack3(); }, 8 * beat * 1000);
  }

  const tracks = [playTrack0, playTrack1, playTrack2, playTrack3];

  function startMusic(trackIdx) {
    ensureCtx();
    stopMusic();
    currentTrack = trackIdx || 0;
    musicPlaying = true;
    tracks[currentTrack % tracks.length]();
  }

  function stopMusic() {
    musicPlaying = false;
    clearTimeout(musicTimeout);
  }

  function toggleMute() {
    muted = !muted;
    if (muted) {
      stopMusic();
      if (masterGain) masterGain.gain.value = 0;
    } else {
      if (masterGain) masterGain.gain.value = 1.0;
    }
    return muted;
  }

  function isMuted() { return muted; }

  // ─── Public API ─────────────────────────────────────
  return {
    init, startMusic, stopMusic, toggleMute, isMuted,
    tick: tickSound,
    correct: correctSound,
    wrong: wrongSound,
    timeUp: timeUpSound,
    reveal: revealSound,
    roundStart: roundStartSound,
    roundComplete: roundCompleteSound,
    winner: winnerSound,
    playerJoin: playerJoinSound
  };
})();
