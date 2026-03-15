// ═══ PARTY GAME AUDIO SYSTEM ══════════════════════════════════════
window.GameAudio = (function() {
  let ctx = null, masterGain = null, musicGain = null, sfxGain = null;
  let muted = false, musicPlaying = false, musicTimer = null, trackIdx = 0;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.13; musicGain.connect(masterGain);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(masterGain);
  }

  function ensure() { init(); if (ctx.state === 'suspended') ctx.resume(); }

  function tone(freq, start, dur, type, vol, tgt) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2200;
    o.connect(f); f.connect(g); g.connect(tgt || sfxGain);
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol || 0.1, start + 0.015);
    g.gain.setValueAtTime(vol || 0.1, start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.start(start); o.stop(start + dur + 0.05);
  }

  function chrd(notes, s, d, t, v, tgt) { notes.forEach(n => tone(n, s, d, t, (v || 0.06) / notes.length, tgt)); }

  function nz(start, dur, vol) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 7000; f.Q.value = 0.5;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(sfxGain);
    g.gain.setValueAtTime(vol || 0.04, start); g.gain.linearRampToValueAtTime(0, start + dur);
    src.start(start); src.stop(start + dur + 0.01);
  }

  // ═══ SOUND EFFECTS ═════════════════════════════════
  function tick() { if (muted) return; ensure(); tone(1200, ctx.currentTime, 0.06, 'square', 0.05); }

  function correct() {
    if (muted) return; ensure(); const t = ctx.currentTime;
    [523, 659, 784, 1047, 1319].forEach((n, i) => { tone(n, t + i * 0.07, 0.22, 'sine', 0.1); tone(n * 0.5, t + i * 0.07, 0.18, 'triangle', 0.05); });
    for (let i = 0; i < 4; i++) nz(t + 0.1 + i * 0.12, 0.12, 0.025);
  }

  function wrong() { if (muted) return; ensure(); const t = ctx.currentTime; tone(300, t, 0.15, 'sawtooth', 0.07); tone(200, t + 0.1, 0.2, 'sawtooth', 0.05); }

  function timeUp() {
    if (muted) return; ensure(); const t = ctx.currentTime;
    tone(220, t, 0.4, 'sawtooth', 0.08); tone(185, t + 0.05, 0.4, 'sawtooth', 0.06); tone(165, t + 0.1, 0.4, 'square', 0.05);
  }

  function reveal() {
    if (muted) return; ensure(); const t = ctx.currentTime;
    [262, 330, 392, 523, 659, 784].forEach((n, i) => tone(n, t + i * 0.05, 0.25, 'sine', 0.07));
    chrd([523, 659, 784, 1047], t + 0.35, 0.7, 'sine', 0.14); chrd([262, 330, 392, 523], t + 0.35, 0.7, 'triangle', 0.07);
  }

  function roundStart() {
    if (muted) return; ensure(); const t = ctx.currentTime;
    [[392, 0, 0.12], [392, 0.12, 0.12], [523, 0.25, 0.12], [659, 0.4, 0.18], [784, 0.6, 0.35]].forEach(([n, o, d]) => { tone(n, t + o, d, 'sawtooth', 0.05); tone(n, t + o, d, 'square', 0.03); });
    for (let i = 0; i < 10; i++) nz(t + i * 0.07, 0.06, 0.03);
  }

  function roundComplete() {
    if (muted) return; ensure(); const t = ctx.currentTime;
    chrd([523, 659, 784], t, 0.28, 'sine', 0.1); chrd([587, 740, 880], t + 0.28, 0.28, 'sine', 0.1);
    chrd([659, 784, 1047], t + 0.56, 0.45, 'sine', 0.13); chrd([523, 659, 784, 1047], t + 1.0, 0.7, 'triangle', 0.08);
    for (let i = 0; i < 35; i++) nz(t + 0.4 + Math.random() * 2.5, 0.02 + Math.random() * 0.04, 0.015 + Math.random() * 0.02);
  }

  function winner() {
    if (muted) return; ensure(); const t = ctx.currentTime;
    [[392, 494, 587], [440, 554, 659], [494, 622, 740], [523, 659, 784, 1047]].forEach((n, i) => { chrd(n, t + i * 0.35, 0.45, 'sine', 0.13); chrd(n, t + i * 0.35, 0.45, 'triangle', 0.07); });
    for (let i = 0; i < 12; i++) tone(1500 + Math.random() * 2500, t + 1.4 + i * 0.08, 0.12, 'sine', 0.03);
    for (let i = 0; i < 60; i++) nz(t + 0.8 + Math.random() * 3.5, 0.02 + Math.random() * 0.05, 0.012 + Math.random() * 0.018);
  }

  function playerJoin() { if (muted) return; ensure(); const t = ctx.currentTime; tone(880, t, 0.08, 'sine', 0.07); tone(1047, t + 0.07, 0.12, 'sine', 0.09); }

  // ═══ BACKGROUND MUSIC (4 exciting tracks) ══════════

  // Track 0: Game show excitement
  function track0() {
    if (!musicPlaying || muted) return; const t = ctx.currentTime, bt = 60 / 132;
    [130.8, 164.8, 146.8, 174.6, 130.8, 164.8, 196, 174.6].forEach((n, i) => tone(n, t + i * bt, bt * 0.7, 'triangle', 0.1, musicGain));
    [[0, [523, 659, 784]], [2, [587, 740, 880]], [4, [523, 659, 784]], [6, [440, 554, 659]]].forEach(([b, n]) => chrd(n, t + b * bt, bt * 0.4, 'square', 0.05, musicGain));
    for (let i = 0; i < 16; i++) nz(t + i * bt * 0.5, 0.025, i % 2 === 0 ? 0.025 : 0.012);
    [0, 2, 4, 6].forEach(b => tone(55, t + b * bt, 0.12, 'sine', 0.08, musicGain));
    musicTimer = setTimeout(() => { if (musicPlaying) track0(); }, 8 * bt * 1000);
  }

  // Track 1: Funky TV groove
  function track1() {
    if (!musicPlaying || muted) return; const t = ctx.currentTime, bt = 60 / 118;
    [98, 0, 98, 110, 0, 130.8, 0, 110].forEach((n, i) => { if (n) tone(n, t + i * bt, bt * 0.5, 'sawtooth', 0.07, musicGain); });
    chrd([330, 415, 523], t, bt * 2, 'sine', 0.04, musicGain);
    chrd([349, 440, 554], t + bt * 2, bt * 2, 'sine', 0.04, musicGain);
    chrd([294, 370, 466], t + bt * 4, bt * 2, 'sine', 0.04, musicGain);
    chrd([330, 415, 523], t + bt * 6, bt * 2, 'sine', 0.04, musicGain);
    [1, 3, 5, 7].forEach(b => nz(t + b * bt, 0.04, 0.03));
    [0, 4].forEach(b => tone(55, t + b * bt, 0.1, 'sine', 0.06, musicGain));
    musicTimer = setTimeout(() => { if (musicPlaying) track1(); }, 8 * bt * 1000);
  }

  // Track 2: Cinematic tension
  function track2() {
    if (!musicPlaying || muted) return; const t = ctx.currentTime, bt = 60 / 105;
    for (let i = 0; i < 8; i++) { tone(65.4, t + i * bt, bt * 0.35, 'sine', 0.1, musicGain); tone(65.4, t + i * bt, bt * 0.35, 'triangle', 0.05, musicGain); }
    chrd([196, 233, 294, 349], t, bt * 4, 'sine', 0.035, musicGain);
    chrd([185, 220, 277, 330], t + bt * 4, bt * 4, 'sine', 0.035, musicGain);
    [0, 3, 5].forEach(b => tone(98, t + b * bt, 0.25, 'sawtooth', 0.04, musicGain));
    tone(440, t + bt * 2, bt * 1.5, 'sawtooth', 0.015, musicGain);
    tone(466, t + bt * 6, bt * 1.5, 'sawtooth', 0.015, musicGain);
    musicTimer = setTimeout(() => { if (musicPlaying) track2(); }, 8 * bt * 1000);
  }

  // Track 3: High energy electronic
  function track3() {
    if (!musicPlaying || muted) return; const t = ctx.currentTime, bt = 60 / 142;
    for (let i = 0; i < 8; i++) tone(55 + (i % 2) * 10, t + i * bt, bt * 0.25, 'sine', 0.12, musicGain);
    [523, 659, 784, 1047, 784, 659, 523, 392].forEach((n, i) => tone(n, t + i * bt, bt * 0.35, 'square', 0.025, musicGain));
    for (let i = 0; i < 16; i++) nz(t + i * bt * 0.5, 0.018, 0.02);
    chrd([196, 294, 392], t, bt * 0.25, 'sawtooth', 0.05, musicGain);
    chrd([220, 330, 440], t + bt * 4, bt * 0.25, 'sawtooth', 0.05, musicGain);
    musicTimer = setTimeout(() => { if (musicPlaying) track3(); }, 8 * bt * 1000);
  }

  const tracks = [track0, track1, track2, track3];

  function startMusic(idx) { ensure(); stopMusic(); trackIdx = idx || 0; musicPlaying = true; tracks[trackIdx % tracks.length](); }
  function stopMusic() { musicPlaying = false; clearTimeout(musicTimer); }

  function toggleMute() {
    muted = !muted;
    if (muted) { stopMusic(); if (masterGain) masterGain.gain.value = 0; }
    else { if (masterGain) masterGain.gain.value = 1.0; }
    return muted;
  }

  return { init, startMusic, stopMusic, toggleMute, isMuted: () => muted,
    tick, correct, wrong, timeUp, reveal, roundStart, roundComplete, winner, playerJoin };
})();
