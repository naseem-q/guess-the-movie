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

function genCode() { let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms[code]); return code; }
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function normalize(s) { return s.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9\u0600-\u06FF\u0750-\u077F]/g, '').trim(); }
async function tmdb(ep) { const hasLang = ep.includes('language='); const url = `https://api.themoviedb.org/3${ep}${ep.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}${hasLang ? '' : '&language=en-US'}`; const r = await fetch(url); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); }

// ═══ TMDB CACHE ══════════════════════════════════════
const cache = { movies: null, tv: null, ts: 0 };
async function loadTMDB() {
  if (cache.movies && Date.now() - cache.ts < 3600000) return;
  console.log('[TMDB] Loading top rated + popular (English only)...');
  try {
    const movies = [], tv = [];
    const seen_m = new Set(), seen_t = new Set();

    // Fetch BOTH popular AND top_rated for movies (top 200+)
    for (const endpoint of ['/movie/popular', '/movie/top_rated']) {
      for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        try {
          const d = await tmdb(`${endpoint}?page=${p}`);
          for (const m of (d.results || [])) {
            if (m.poster_path && m.backdrop_path && m.title && m.original_language === 'en' && !seen_m.has(m.id)) {
              seen_m.add(m.id);
              movies.push(m); // m includes genre_ids array
            }
          }
        } catch (e) {}
      }
    }

    // Fetch BOTH popular AND top_rated for TV shows
    for (const endpoint of ['/tv/popular', '/tv/top_rated']) {
      for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        try {
          const d = await tmdb(`${endpoint}?page=${p}`);
          for (const t of (d.results || [])) {
            if (t.poster_path && t.backdrop_path && t.name && t.original_language === 'en' && !seen_t.has(t.id)) {
              seen_t.add(t.id);
              tv.push(t); // t includes genre_ids array
            }
          }
        } catch (e) {}
      }
    }

    cache.movies = movies; cache.tv = tv; cache.ts = Date.now();
    console.log(`[TMDB] ${movies.length} movies, ${tv.length} TV shows loaded`);
  } catch (e) { console.error('[TMDB]', e.message); if (!cache.movies) { cache.movies = []; cache.tv = []; } }
}

// ═══ GENRE-MATCHED WRONG OPTIONS ═════════════════════
function getGenreMatchedWrong(correct, allItems, titleField = 'title', count = 3) {
  const correctGenres = correct.genre_ids || [];
  const correctTitle = correct[titleField];

  // Find items that share at least one genre
  const sameGenre = allItems.filter(x =>
    x.id !== correct.id &&
    x[titleField] !== correctTitle &&
    x.genre_ids && x.genre_ids.some(g => correctGenres.includes(g))
  );

  // Shuffle and pick from same genre first
  const picked = shuffle(sameGenre).slice(0, count).map(x => x[titleField]);

  // If not enough same-genre, fill from all items
  if (picked.length < count) {
    const remaining = allItems.filter(x =>
      x.id !== correct.id && !picked.includes(x[titleField])
    );
    picked.push(...shuffle(remaining).slice(0, count - picked.length).map(x => x[titleField]));
  }

  return picked.slice(0, count);
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
// Genres to exclude (talk shows, reality, news, documentaries)
const EXCLUDED_GENRES = [10767, 10763, 10764, 10766, 99]; // talk, news, reality, soap, documentary
const EXCLUDED_KEYWORDS = ['himself', 'herself', 'self', 'host', 'narrator', 'voice', 'uncredited', 'guest'];

async function getActorCharacter(person) {
  try {
    const cr = await tmdb(`/person/${person.id}/combined_credits`);
    if (!cr.cast?.length) return null;
    // Filter: English only, real character names, no talk shows / self appearances
    const roles = cr.cast.filter(r => {
      if (!r.character || r.character.length < 2 || r.character.length > 40) return false;
      if (r.character.includes('/')) return false;
      if (r.original_language !== 'en') return false;
      // Exclude "Self", "Himself", "Herself", "Host", etc.
      const charLow = r.character.toLowerCase();
      if (EXCLUDED_KEYWORDS.some(kw => charLow.includes(kw))) return false;
      // Exclude talk show / reality / news genres
      if (r.genre_ids && r.genre_ids.some(g => EXCLUDED_GENRES.includes(g))) return false;
      return true;
    }).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    if (!roles.length) return null;
    const role = roles[0];
    const title = role.title || role.name;
    const mt = role.media_type || (role.title ? 'movie' : 'tv');

    // Verify it's actually a scripted show/movie by checking genres
    try {
      const detail = await tmdb(`/${mt}/${role.id}`);
      if (detail.genres) {
        const genreIds = detail.genres.map(g => g.id);
        if (genreIds.some(g => EXCLUDED_GENRES.includes(g))) return null;
      }
    } catch (e) {}

    let others = [];
    try {
      const sc = await tmdb(`/${mt}/${role.id}/credits`);
      others = (sc.cast || []).filter(c =>
        c.character?.length > 1 && c.character.length < 40
        && normalize(c.character) !== normalize(role.character)
        && !c.character.includes('/')
        && !c.character.includes('(')
        && !EXCLUDED_KEYWORDS.some(kw => c.character.toLowerCase().includes(kw))
      ).map(c => c.character);
    } catch (e) {}

    if (others.length < 3) {
      for (const r of roles.slice(1, 8)) {
        if (r.character && normalize(r.character) !== normalize(role.character) && !EXCLUDED_KEYWORDS.some(kw => r.character.toLowerCase().includes(kw))) {
          others.push(r.character);
        }
        if (others.length >= 3) break;
      }
    }
    if (others.length < 3) return null;
    return { actor: person.name, image: `${TMDB_IMG}h632${person.profile_path}`, character: role.character, show: title, wrong: shuffle(others).slice(0, 3) };
  } catch (e) { return null; }
}

// ═══ QUESTION GENERATORS ═════════════════════════════
async function genMoviePosterQ() {
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  let img = await getTextlessPoster(m.id, 'movie'); if (!img) img = `${TMDB_IMG}w780${m.poster_path}`;
  const wrong = getGenreMatchedWrong(m, cache.movies, 'title');
  return { type: 'movie_poster', category: 'Movie Posters', question: 'What movie is this?', image: img, revealImage: `${TMDB_IMG}w780${m.poster_path}`, answer: m.title, options: shuffle([m.title, ...wrong]), year: m.release_date?.split('-')[0] || '', info: m.title };
}
async function genTVPosterQ() {
  const s = cache.tv[Math.floor(Math.random() * cache.tv.length)];
  let img = await getTextlessPoster(s.id, 'tv'); if (!img) img = `${TMDB_IMG}w780${s.poster_path}`;
  const wrong = getGenreMatchedWrong(s, cache.tv, 'name');
  return { type: 'tv_poster', category: 'TV Show Posters', question: 'What TV show is this?', image: img, revealImage: `${TMDB_IMG}w780${s.poster_path}`, answer: s.name, options: shuffle([s.name, ...wrong]), year: s.first_air_date?.split('-')[0] || '', info: s.name };
}
async function genMovieSceneQ() {
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  let img = await getSceneStill(m.id, 'movie'); if (!img) img = `${TMDB_IMG}w1280${m.backdrop_path}`;
  const wrong = getGenreMatchedWrong(m, cache.movies, 'title');
  return { type: 'movie_scene', category: 'Movie Scenes', question: 'What movie is this scene from?', image: img, revealImage: img, answer: m.title, options: shuffle([m.title, ...wrong]), year: m.release_date?.split('-')[0] || '', info: m.title };
}
async function genTVSceneQ() {
  const s = cache.tv[Math.floor(Math.random() * cache.tv.length)];
  let img = await getTVStill(s.id); if (!img) img = await getSceneStill(s.id, 'tv'); if (!img) img = `${TMDB_IMG}w1280${s.backdrop_path}`;
  const wrong = getGenreMatchedWrong(s, cache.tv, 'name');
  return { type: 'tv_scene', category: 'TV Show Scenes', question: 'What TV show is this scene from?', image: img, revealImage: img, answer: s.name, options: shuffle([s.name, ...wrong]), year: s.first_air_date?.split('-')[0] || '', info: s.name };
}
async function genCharacterQ() {
  // Pick from our cached movies and TV shows (not popular people - those include talk show hosts)
  const allShows = shuffle([...cache.movies.map(m => ({id: m.id, type: 'movie', title: m.title})), ...cache.tv.map(t => ({id: t.id, type: 'tv', title: t.name}))]);

  for (const show of allShows.slice(0, 15)) {
    try {
      const credits = await tmdb(`/${show.type}/${show.id}/credits`);
      if (!credits.cast?.length) continue;

      // Find actors with real character names (not self/host)
      const validCast = credits.cast.filter(c =>
        c.character?.length > 1 && c.character.length < 40
        && !c.character.includes('/')
        && !EXCLUDED_KEYWORDS.some(kw => c.character.toLowerCase().includes(kw))
        && c.profile_path
      );

      if (validCast.length < 4) continue; // Need at least 4 for question + 3 wrong

      const actor = validCast[0]; // Lead actor
      const wrongChars = validCast.slice(1).map(c => c.character).filter(ch => normalize(ch) !== normalize(actor.character));

      if (wrongChars.length < 3) continue;

      return {
        type: 'character', category: 'Guess the Character',
        question: `What character does this actor play in "${show.title}"?`,
        image: `${TMDB_IMG}h632${actor.profile_path}`,
        revealImage: `${TMDB_IMG}h632${actor.profile_path}`,
        answer: actor.character,
        options: shuffle([actor.character, ...shuffle(wrongChars).slice(0, 3)]),
        year: '', info: `${actor.character} (${actor.name}) — ${show.title}`
      };
    } catch (e) { continue; }
  }

  // Fallback: use a movie scene question instead
  const m = cache.movies[Math.floor(Math.random() * cache.movies.length)];
  return { type: 'character', category: 'Guess the Character', question: 'What movie is this from?', image: `${TMDB_IMG}w1280${m.backdrop_path}`, revealImage: `${TMDB_IMG}w1280${m.backdrop_path}`, answer: m.title, options: shuffle([m.title, ...shuffle(cache.movies.filter(x => x.id !== m.id).map(x => x.title)).slice(0, 3)]), year: '', info: m.title };
}

const GENS = { movie_posters: genMoviePosterQ, tv_posters: genTVPosterQ, movie_scenes: genMovieSceneQ, tv_scenes: genTVSceneQ, characters: genCharacterQ };

// ═══ FLAGS CATEGORY ══════════════════════════════════
const flagCache = { countries: null, ts: 0 };

const FLAG_EASY = ['US','GB','FR','DE','IT','ES','JP','CN','BR','CA','AU','IN','MX','RU','KR','TR','EG','SA','AE','GR','NL','SE','NO','PL','AR','CO','CL','PT','ZA','NZ','IE','CH','AT','BE','DK','TH','ID','PH','VN','MY','SG','JO','QA','KW','NG','KE','PK','BD'];
const FLAG_HARD_EXCLUDE = new Set(FLAG_EASY);

// Wikimedia thumbnail helper — reliable URL format
function wiki(file, w = 800) {
  const f = file.replace(/ /g, '_');
  const md5 = require('crypto').createHash('md5').update(f).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5[0]}${md5[1]}/${f}/${w}px-${f}`;
}

// Simpler: use Pexels-style search URLs pre-resolved. Instead, use flagcdn for flags
// and for landmarks/capitals, use a search-based image proxy that always works.
// Most reliable: use the country code to get images from teleport or similar.

// For landmarks and capitals, we'll use a simple approach:
// Search Pexels at game-creation time if PEXELS_KEY is set, otherwise fallback to flags
const PEXELS_KEY = process.env.PEXELS_KEY || '';

async function searchImage(query) {
  if (!PEXELS_KEY) return null;
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`, {
      headers: { 'Authorization': PEXELS_KEY }
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.photos && d.photos.length > 0) {
      const photo = d.photos[Math.floor(Math.random() * Math.min(d.photos.length, 3))];
      return photo.src.landscape || photo.src.large;
    }
  } catch (e) {}
  return null;
}

// Landmarks with search queries for Pexels
const LANDMARKS = {
  US:{name:'Statue of Liberty',q:'statue of liberty new york'},
  GB:{name:'Big Ben',q:'big ben london'},
  FR:{name:'Eiffel Tower',q:'eiffel tower paris'},
  DE:{name:'Brandenburg Gate',q:'brandenburg gate berlin'},
  IT:{name:'Colosseum',q:'colosseum rome'},
  ES:{name:'Sagrada Familia',q:'sagrada familia barcelona'},
  JP:{name:'Mount Fuji',q:'mount fuji japan'},
  CN:{name:'Great Wall of China',q:'great wall china'},
  BR:{name:'Christ the Redeemer',q:'christ redeemer rio'},
  CA:{name:'CN Tower',q:'cn tower toronto'},
  AU:{name:'Sydney Opera House',q:'sydney opera house'},
  IN:{name:'Taj Mahal',q:'taj mahal india'},
  MX:{name:'Chichen Itza',q:'chichen itza mexico'},
  RU:{name:'Saint Basil\'s Cathedral',q:'saint basils cathedral moscow'},
  KR:{name:'Gyeongbokgung Palace',q:'gyeongbokgung palace seoul'},
  TR:{name:'Hagia Sophia',q:'hagia sophia istanbul'},
  EG:{name:'Pyramids of Giza',q:'pyramids giza egypt'},
  SA:{name:'Kaaba',q:'kaaba mecca'},
  AE:{name:'Burj Khalifa',q:'burj khalifa dubai'},
  GR:{name:'Parthenon',q:'parthenon athens'},
  NL:{name:'Windmills of Kinderdijk',q:'kinderdijk windmills netherlands'},
  TH:{name:'Wat Arun',q:'wat arun bangkok'},
  ID:{name:'Borobudur',q:'borobudur temple java'},
  PE:{name:'Machu Picchu',q:'machu picchu peru'},
  JO:{name:'Petra',q:'petra jordan treasury'},
  KH:{name:'Angkor Wat',q:'angkor wat cambodia'},
  MA:{name:'Hassan II Mosque',q:'hassan mosque casablanca'},
  CZ:{name:'Prague Castle',q:'prague castle'},
  NP:{name:'Mount Everest',q:'mount everest nepal'},
  CH:{name:'Matterhorn',q:'matterhorn switzerland'},
  PT:{name:'Tower of Belém',q:'belem tower lisbon'},
  AT:{name:'Schönbrunn Palace',q:'schonbrunn palace vienna'},
  HU:{name:'Hungarian Parliament',q:'hungarian parliament budapest'},
  HR:{name:'Dubrovnik Old Town',q:'dubrovnik croatia'},
  IS:{name:'Blue Lagoon',q:'blue lagoon iceland'},
  SG:{name:'Marina Bay Sands',q:'marina bay sands singapore'},
  MY:{name:'Petronas Towers',q:'petronas towers kuala lumpur'},
  KW:{name:'Kuwait Towers',q:'kuwait towers'},
  QA:{name:'Museum of Islamic Art',q:'museum islamic art doha'},
  PK:{name:'Badshahi Mosque',q:'badshahi mosque lahore'},
  ZA:{name:'Table Mountain',q:'table mountain cape town'},
  SE:{name:'Stockholm Palace',q:'stockholm palace sweden'},
  DK:{name:'Little Mermaid',q:'little mermaid copenhagen'},
  IE:{name:'Cliffs of Moher',q:'cliffs of moher ireland'},
  NO:{name:'Geirangerfjord',q:'geirangerfjord norway'},
  BE:{name:'Grand Place',q:'grand place brussels'},
  NZ:{name:'Milford Sound',q:'milford sound new zealand'},
  LB:{name:'Baalbek',q:'baalbek lebanon temple'},
  PH:{name:'Chocolate Hills',q:'chocolate hills bohol'},
  VN:{name:'Ha Long Bay',q:'halong bay vietnam'},
  FI:{name:'Helsinki Cathedral',q:'helsinki cathedral finland'}
};

// Capital search queries — must include "city" to avoid wrong results
const CAPITAL_QUERIES = {
  US:'washington dc city aerial view',GB:'london city skyline aerial',FR:'paris city aerial view',DE:'berlin city skyline aerial',
  IT:'rome city panoramic view',ES:'madrid city skyline aerial',JP:'tokyo city skyline night',CN:'beijing city skyline aerial',
  BR:'brasilia city congress building',CA:'ottawa city parliament hill',AU:'canberra city parliament house',IN:'new delhi city india gate aerial',
  MX:'mexico city downtown aerial',RU:'moscow city skyline red square',KR:'seoul city skyline night',TR:'ankara city skyline',
  EG:'cairo city skyline aerial',SA:'riyadh city skyline night',AE:'abu dhabi city skyline',GR:'athens city acropolis aerial',
  JO:'amman city skyline aerial view',TH:'bangkok city skyline temple',AR:'buenos aires city obelisk aerial',NL:'amsterdam city canals aerial',
  PT:'lisbon city panoramic view',CH:'bern city old town aerial',SE:'stockholm city skyline aerial',NO:'oslo city skyline aerial',
  AT:'vienna city skyline aerial',BE:'brussels city grand place aerial',DK:'copenhagen city nyhavn aerial',PL:'warsaw city skyline old town',
  IE:'dublin city skyline river',CZ:'prague city castle aerial',HU:'budapest city parliament danube',SG:'singapore city skyline night',
  KW:'kuwait city skyline towers',QA:'doha city skyline corniche',PK:'islamabad city faisal mosque aerial',ZA:'pretoria city union buildings',
  NZ:'wellington city harbour aerial',MY:'kuala lumpur city petronas towers',PH:'manila city skyline aerial',VN:'hanoi city old quarter aerial',
  CO:'bogota city skyline aerial',PE:'lima city skyline aerial',MA:'rabat city hassan tower',PS:'jerusalem city old town aerial',
  LB:'beirut city skyline aerial',KE:'nairobi city skyline aerial',NG:'abuja city mosque aerial'
};

// Image cache to avoid re-fetching during same session
const imageCache = {};
async function getCachedImage(key, query, fallback) {
  if (imageCache[key]) return imageCache[key];
  const img = await searchImage(query);
  if (img) { imageCache[key] = img; return img; }
  return fallback;
}

// Banknote filenames on Wikimedia Commons — server resolves to thumbnail URLs
const BANKNOTE_FILES = {
  US:'US_one_dollar_bill,_obverse,_series_2009.jpg',
  GB:'Bank_of_England_£50_obverse.jpg',
  JP:'Series_E_10K_Yen_Bank_of_Japan_note_-_front.jpg',
  CN:'RMB4_100_a.jpg',
  BR:'50_BRL_note_(2010)_obverse.jpg',
  CA:'Canadian_Frontier_Banknotes_faces.png',
  AU:'Australian_five_dollar_note_-_Polymer_front.jpg',
  IN:'India_500_INR,_MG_series,_2016,_obverse.jpg',
  MX:'MXN_200_F_new.png',
  RU:'Banknote_5000_rubles_2010_front.jpg',
  KR:'10000_won_serieVI_obverse.jpeg',
  TR:'100_türk_lirası_front.jpg',
  EG:'EGP_200_2022_obverse.jpg',
  SA:'Saudi_Riyal_500.jpg',
  AE:'United_Arab_Emirates_100_dirham_note_front.jpg',
  JO:'20_JOD_-_front.jpg',
  TH:'1000_THB-XVII_Obverse.jpg',
  CH:'CHF_50_9_front.jpg',
  SE:'100_SEK_front.jpg',
  NO:'200-krone_2017_obverse.jpg',
  DK:'DKK_500_obverse_(2009).jpg',
  PL:'100_zł_a_2012.jpg',
  CZ:'1000_CZK_2008_obverse.jpg',
  HU:'HUF_10000_2019_obverse.jpg',
  AR:'1000_Pesos_Argentina_front.jpg',
  NZ:'New_Zealand,_$5_note,_2015_(obverse).jpg',
  ZA:'South_Africa-Rand-200-Obverse.jpg',
  PK:'SBP_1000_rupee_note.jpg',
  MY:'RM50_4th.jpg',
  SG:'SGD_50_front.jpg',
  KW:'20_Kuwaiti_dinar.jpg',
  QA:'500_Qatari_Riyal.jpg',
  NG:'1000_naira_front.jpg',
  KE:'Kenya_1000_shillings_2019_obv.jpg',
  ID:'100000_rupiah_bill,_2022_revision_(obverse).jpg',
  PH:'PHP_1000_2010_obverse.jpg',
  VN:'Vietnam_500000_Dong_Front.jpg',
  BD:'1000_Taka_front_Bangladesh_Bank_(2011).jpg'
};

// Resolve Wikimedia Commons filename to a CORS-friendly thumbnail URL via API
async function resolveWikimediaImage(filename) {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PartyGame/1.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const pages = d.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (page?.imageinfo?.[0]?.thumburl) return page.imageinfo[0].thumburl;
    if (page?.imageinfo?.[0]?.url) return page.imageinfo[0].url;
  } catch (e) {}
  return null;
}

// Get currency image — resolve from Wikimedia, cache, fallback to Pexels then flag
async function getCurrencyImage(code, cur, flagUrl) {
  const cacheKey = 'cur_' + code;
  if (imageCache[cacheKey]) return imageCache[cacheKey];

  // Try Wikimedia Commons banknote image
  if (BANKNOTE_FILES[code]) {
    const img = await resolveWikimediaImage(BANKNOTE_FILES[code]);
    if (img) { imageCache[cacheKey] = img; return img; }
  }

  // Fallback to Pexels
  if (PEXELS_KEY) {
    const pImg = await searchImage(cur.q);
    if (pImg) { imageCache[cacheKey] = pImg; return pImg; }
  }

  return flagUrl;
}

// 3 rotating hints per country — harder, no obvious giveaways
const HINTS = {
  US:['Has 50 states and a famous bald eagle','Independence declared on July 4th, 1776','Borders only two other countries'],
  GB:['An island with a constitutional monarchy','Drives on the left side of the road','Once ruled the largest empire in history'],
  FR:['Has a famous tower built for an 1889 exhibition','Borders 8 countries in mainland territory','Known for its wine regions and haute cuisine'],
  DE:['Reunified in 1990 after decades of division','The most populous EU member state','Famous for its car industry and autobahns'],
  IT:['Shaped like a piece of footwear','Contains the world\'s smallest country within it','Home to the oldest university in the Western world'],
  ES:['Has 17 autonomous communities','Located on the Iberian Peninsula','Famous for its afternoon rest tradition'],
  JP:['An archipelago of 6,852 islands','Has the world\'s oldest monarchy','Known for its bullet trains'],
  CN:['Has the most spoken native language','Uses a logographic writing system','Home to giant pandas in the wild'],
  BR:['Largest Portuguese-speaking country','Home to 60% of a massive rainforest','Won the most FIFA World Cups'],
  CA:['Has the longest coastline of any country','Two official languages spoken nationwide','Famous for a sweet tree syrup'],
  AU:['The only country that is also a continent','Has the world\'s largest coral reef','More sheep than people live here'],
  IN:['Has 22 officially recognized languages','World\'s largest film industry by output','Home to a river considered sacred'],
  MX:['Has 31 states plus a capital district','Ancient pyramids still stand in its jungles','One of the world\'s largest silver producers'],
  RU:['Largest country by land area','Has 9 time zones','Contains the world\'s deepest freshwater lake'],
  KR:['Internet speeds rank among the world\'s fastest','Has an alphabet invented by a king','Shares a heavily fortified border'],
  TR:['Spans two continents','Its largest city was once called Constantinople','Famous for hot air balloon landscapes'],
  EG:['The Nile runs through its heart','Over 5,000 years of continuous civilization','Ancient writing used picture symbols'],
  SA:['Hosts millions of pilgrims annually','Named after its founding family','Has no rivers that flow year-round'],
  AE:['A federation formed in 1971','Has the world\'s tallest building','Southeastern tip of the Arabian Peninsula'],
  GR:['Birthplace of the Olympic Games','Has over 6,000 islands','The word "democracy" comes from its language'],
  NL:['About one-third is below sea level','Has more bicycles than people','Famous for water management systems'],
  SE:['Home to a famous flat-pack furniture brand','Has a right of public access to nature','Nobel Prize ceremony is held here'],
  NO:['Has some of the deepest inlets in the world','Midnight sun occurs in summer','One of the top oil exporters'],
  PL:['Home to one of Europe\'s oldest salt mines','A famous nocturne composer was born here','Central Europe with Baltic coastline'],
  AR:['Named after the Latin word for silver','Home to the southernmost city in the world','Has the widest avenue on Earth'],
  JO:['Home to one of the lowest points on Earth','An ancient city carved into rose-red cliffs','A kingdom in the heart of the Middle East'],
  TH:['Never colonized by a European power','Its name means "Land of the Free"','Famous for its floating markets'],
  ID:['The world\'s largest island country','Has over 270 million people','Spans three time zones'],
  SG:['One of only three surviving city-states','One of the busiest ports in the world','Chewing gum sales are restricted here'],
  MY:['Divided into two regions by a sea','Has one of the oldest tropical rainforests','National sport uses a rattan ball'],
  CH:['Has four official languages','Landlocked and mountainous','Famous for banking and alpine scenery'],
  AT:['Famous for its classical music heritage','Landlocked in Central Europe','Home to the world\'s oldest zoo'],
  PT:['Westernmost country in mainland Europe','Famous for tiled building facades','Navigators sailed around Africa from here'],
  ZA:['Has three capital cities','Two Nobel Peace Prize winners from one struggle','Southern tip of its continent'],
  NZ:['First country where women could vote','Filming location for a famous fantasy trilogy','Has more sheep than people'],
  IE:['Known for its emerald-green landscape','The harp is its national symbol','Ancient festivals inspired modern Halloween'],
  DK:['The oldest monarchy in Europe','Famous for a toy brick company','Consistently ranked the happiest country'],
  BE:['The EU headquarters is located here','Has three official languages','Known for over 1,500 varieties of a treat'],
  PK:['Home to the second highest peak on Earth','World\'s largest canal-based irrigation','The Indus Valley civilization began here'],
  KW:['One of the highest per-capita incomes','Located at the tip of the Persian Gulf','Gained independence in 1961'],
  QA:['A peninsula in the Persian Gulf','One of the highest GDPs per capita','Hosted a major sporting event in 2022'],
  PS:['Its capital is sacred to three religions','Along the Mediterranean and Jordan Valley','Home to one of the oldest cities in the world'],
  NG:['Most populous country in Africa','Over 500 spoken languages','Major oil producer in West Africa'],
  KE:['Famous for long-distance runners','Home to the Great Rift Valley','Its name means "mountain of brightness"'],
  BD:['One of the most densely populated countries','Known for its vast river delta','Located in South Asia'],
  VN:['Has a bay with limestone islands','World\'s largest exporter of a certain grain','Territory shaped like the letter S'],
  PH:['An archipelago of over 7,000 islands','Named after a 16th century European king','Home to the world\'s smallest primate'],
  CZ:['Has over 2,000 castles','Birthplace of contact lenses','One of the highest beer consumption rates'],
  HU:['Its language is unrelated to neighbors','Famous for thermal bath culture','Landlocked in Central Europe'],
  LB:['One of the smallest in the Middle East','A cedar tree is its national symbol','Once called the Paris of the Middle East'],
  NP:['Home to 8 of the 14 highest peaks','Its flag is non-rectangular','Landlocked between two giant neighbors'],
  FI:['Has more saunas than cars','Land of a Thousand Lakes','Birthplace of a famous mobile phone brand'],
  IS:['Sits on the Mid-Atlantic Ridge','Has no standing army','Geothermal energy heats most buildings'],
  HR:['Over 1,000 islands on the Adriatic','Home to a famous walled medieval city','Shaped like a crescent along its coast'],
  CO:['World\'s top emerald producer','Coastline on two oceans','Named after an explorer who never visited'],
  PE:['Home to an ancient citadel in the clouds','Has the deepest canyon in the world','A high-altitude lake on its border'],
  MA:['Northwest corner of Africa','Atlantic and Mediterranean coastlines','Famous for colorful souks and medinas']
};

function getHints(c) {
  if (HINTS[c.code]) return HINTS[c.code];
  return [`Located in ${c.subregion}`,`Part of the ${c.region} region`,`Its capital has ${c.capital?.length || '?'} letters`];
}

async function loadFlags() {
  if (flagCache.countries && Date.now() - flagCache.ts < 86400000) return;
  console.log('[FLAGS] Loading countries...');
  try {
    const r = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,capital,region,subregion');
    const data = await r.json();
    // Exclude non-sovereign territories, dependencies, and obscure places
    const EXCLUDED = new Set(['IL','SJ','BV','HM','TF','UM','AQ','GS','IO','PN','SH','FK','GI','AX','BL','MF','SX','CW','BQ','PM','WF','TK','NU','NR','TV','CC','CX','NF','MS','AI','VG','TC','KY','BM','GP','MQ','RE','YT','GF','NC','PF','AS','GU','MP','VI','PR','CK']);
    flagCache.countries = data.filter(c => c.cca2 && c.name?.common && !EXCLUDED.has(c.cca2)).map(c => {
      let capital = (c.capital && c.capital[0]) || 'N/A';
      if (c.cca2 === 'PS') capital = 'Jerusalem';
      return { code: c.cca2, name: c.name.common, capital, region: c.region || 'Unknown', subregion: c.subregion || c.region || 'Unknown', flag: `https://flagcdn.com/w640/${c.cca2.toLowerCase()}.png` };
    });
    flagCache.ts = Date.now();
    console.log(`[FLAGS] ${flagCache.countries.length} countries loaded`);
  } catch (e) { console.error('[FLAGS]', e.message); if (!flagCache.countries) flagCache.countries = []; }
}

function getFlagPool(diff) {
  const all = flagCache.countries || [];
  if (diff === 'easy') return all.filter(c => FLAG_EASY.includes(c.code));
  if (diff === 'hard') return all.filter(c => !FLAG_HARD_EXCLUDE.has(c.code) && c.capital !== 'N/A');
  return all.filter(c => c.capital !== 'N/A');
}

function flagWrong(correct, pool, field = 'name', sameRegion = true, count = 3) {
  let cands = sameRegion ? pool.filter(c => c.region === correct.region && c[field] !== correct[field]) : pool.filter(c => c[field] !== correct[field]);
  if (cands.length < count) cands = pool.filter(c => c[field] !== correct[field]);
  return shuffle(cands).slice(0, count).map(c => c[field]);
}

// Round 1: Guess the Flag
function genFlagCountryQ(diff) {
  const pool = getFlagPool(diff); const c = pool[Math.floor(Math.random() * pool.length)];
  return { type: 'flag_country', category: 'Guess the Flag', question: 'What country does this flag belong to?', hints: getHints(c), image: c.flag, revealImage: c.flag, answer: c.name, options: shuffle([c.name, ...flagWrong(c, pool)]), year: '', info: c.name, landscape: true };
}

// Round 2: Guess the Capital — capital city photo, CLEAR (no blur)
async function genFlagCapitalQ(diff) {
  const pool = getFlagPool(diff).filter(c => c.capital !== 'N/A');
  const c = pool[Math.floor(Math.random() * pool.length)];
  const q = CAPITAL_QUERIES[c.code] || `${c.capital} city skyline`;
  const img = await getCachedImage('cap_' + c.code, q, c.flag);
  return { type: 'flag_capital', category: 'Guess the Capital', question: `What is the capital of ${c.name}?`, hints: getHints(c), image: img, revealImage: img, answer: c.capital, options: shuffle([c.capital, ...flagWrong(c, pool, 'capital')]), year: '', info: `${c.capital}, ${c.name}`, landscape: true, noBlur: true };
}

// Round 3: Guess the Continent
function genFlagContinentQ(diff) {
  const pool = getFlagPool(diff); const c = pool[Math.floor(Math.random() * pool.length)];
  const allRegions = [...new Set(pool.map(x => x.region))].filter(r => r !== c.region);
  return { type: 'flag_continent', category: 'Guess the Continent', question: 'What continent is this country in?', hints: [`This country is called ${c.name}`, ...getHints(c).slice(0,2)], image: c.flag, revealImage: c.flag, answer: c.region, options: shuffle([c.region, ...shuffle(allRegions).slice(0, 3)]), year: '', info: `${c.name} — ${c.region}`, landscape: true };
}

// Round 4: Guess the Currency — currency banknote photo
const CURRENCIES = {
  US:{name:'US Dollar',symbol:'$',q:'us dollar banknote'},
  GB:{name:'British Pound',symbol:'£',q:'british pound sterling banknote'},
  JP:{name:'Japanese Yen',symbol:'¥',q:'japanese yen banknote'},
  CN:{name:'Chinese Yuan',symbol:'¥',q:'chinese yuan renminbi banknote'},
  BR:{name:'Brazilian Real',symbol:'R$',q:'brazilian real banknote'},
  CA:{name:'Canadian Dollar',symbol:'C$',q:'canadian dollar banknote'},
  AU:{name:'Australian Dollar',symbol:'A$',q:'australian dollar banknote'},
  IN:{name:'Indian Rupee',symbol:'₹',q:'indian rupee banknote'},
  MX:{name:'Mexican Peso',symbol:'$',q:'mexican peso banknote'},
  RU:{name:'Russian Ruble',symbol:'₽',q:'russian ruble banknote'},
  KR:{name:'South Korean Won',symbol:'₩',q:'south korean won banknote'},
  TR:{name:'Turkish Lira',symbol:'₺',q:'turkish lira banknote'},
  EG:{name:'Egyptian Pound',symbol:'E£',q:'egyptian pound banknote'},
  SA:{name:'Saudi Riyal',symbol:'﷼',q:'saudi riyal banknote'},
  AE:{name:'UAE Dirham',symbol:'د.إ',q:'uae dirham banknote'},
  JO:{name:'Jordanian Dinar',symbol:'د.ا',q:'jordanian dinar banknote'},
  TH:{name:'Thai Baht',symbol:'฿',q:'thai baht banknote'},
  CH:{name:'Swiss Franc',symbol:'CHF',q:'swiss franc banknote'},
  SE:{name:'Swedish Krona',symbol:'kr',q:'swedish krona banknote'},
  NO:{name:'Norwegian Krone',symbol:'kr',q:'norwegian krone banknote'},
  DK:{name:'Danish Krone',symbol:'kr',q:'danish krone banknote'},
  PL:{name:'Polish Zloty',symbol:'zł',q:'polish zloty banknote'},
  CZ:{name:'Czech Koruna',symbol:'Kč',q:'czech koruna banknote'},
  HU:{name:'Hungarian Forint',symbol:'Ft',q:'hungarian forint banknote'},
  AR:{name:'Argentine Peso',symbol:'$',q:'argentine peso banknote'},
  NZ:{name:'New Zealand Dollar',symbol:'NZ$',q:'new zealand dollar banknote'},
  ZA:{name:'South African Rand',symbol:'R',q:'south african rand banknote'},
  PK:{name:'Pakistani Rupee',symbol:'₨',q:'pakistani rupee banknote'},
  MY:{name:'Malaysian Ringgit',symbol:'RM',q:'malaysian ringgit banknote'},
  SG:{name:'Singapore Dollar',symbol:'S$',q:'singapore dollar banknote'},
  KW:{name:'Kuwaiti Dinar',symbol:'د.ك',q:'kuwaiti dinar banknote'},
  QA:{name:'Qatari Riyal',symbol:'﷼',q:'qatari riyal banknote'},
  NG:{name:'Nigerian Naira',symbol:'₦',q:'nigerian naira banknote'},
  KE:{name:'Kenyan Shilling',symbol:'KSh',q:'kenyan shilling banknote'},
  ID:{name:'Indonesian Rupiah',symbol:'Rp',q:'indonesian rupiah banknote'},
  PH:{name:'Philippine Peso',symbol:'₱',q:'philippine peso banknote'},
  VN:{name:'Vietnamese Dong',symbol:'₫',q:'vietnamese dong banknote'},
  BD:{name:'Bangladeshi Taka',symbol:'৳',q:'bangladeshi taka banknote'}
};

// EURO RULE: skip euro countries unless only 1 euro option in choices
const EURO_COUNTRIES = new Set(['FR','DE','IT','ES','PT','NL','IE','GR','AT','BE','FI','SK','SI','EE','LV','LT','CY','MT','LU','HR']);

// Round 4: Guess the Map Shape — country silhouette from mapsicon
function genFlagMapShapeQ(diff) {
  const pool = getFlagPool(diff);
  const c = pool[Math.floor(Math.random() * pool.length)];
  // mapsicon uses lowercase ISO codes — 512px black silhouette PNG
  const mapImg = `https://raw.githubusercontent.com/djaiss/mapsicon/master/all/${c.code.toLowerCase()}/512.png`;
  return { type: 'flag_mapshape', category: 'Guess the Map Shape', question: 'Which country has this shape?', hints: getHints(c), image: mapImg, revealImage: c.flag, answer: c.name, options: shuffle([c.name, ...flagWrong(c, pool)]), year: '', info: c.name, landscape: true, noBlur: true, lightBg: true };
}

// Round 5: Guess the Landmark — landmark photo, CLEAR (no blur)
async function genFlagLandmarkQ(diff) {
  const pool = getFlagPool(diff).filter(c => LANDMARKS[c.code]);
  if (pool.length < 4) return genFlagCountryQ(diff);
  const c = pool[Math.floor(Math.random() * pool.length)];
  const lm = LANDMARKS[c.code];
  const img = await getCachedImage('lm_' + c.code, lm.q, c.flag);
  const wrongPool = shuffle(pool.filter(x => x.code !== c.code && LANDMARKS[x.code])).slice(0, 3);
  return { type: 'flag_landmark', category: 'Guess the Landmark', question: `Which famous landmark is in ${c.name}?`, hints: getHints(c), image: img, revealImage: img, answer: lm.name, options: shuffle([lm.name, ...wrongPool.map(x => LANDMARKS[x.code].name)]), year: '', info: `${lm.name} — ${c.name}`, landscape: true, noBlur: true };
}


let currentDifficulty = 'medium';
const FLAG_GENS = {
  flag_country: () => genFlagCountryQ(currentDifficulty),
  flag_capital: () => genFlagCapitalQ(currentDifficulty),
  flag_continent: () => genFlagContinentQ(currentDifficulty),
  flag_mapshape: () => genFlagMapShapeQ(currentDifficulty),
  flag_landmark: () => genFlagLandmarkQ(currentDifficulty)
};
Object.assign(GENS, FLAG_GENS);


// ═══ ARABIC MOVIES & TV CATEGORY ═════════════════════
const arabicCache = { movies: null, tv: null, ts: 0 };
const ARABIC_COUNTRIES = 'EG|SY|LB|JO';
const COUNTRY_NAMES_AR = {EG:'مصر',SY:'سوريا',JO:'الأردن',LB:'لبنان'};

async function loadArabic() {
  if (arabicCache.movies && Date.now() - arabicCache.ts < 3600000) return;
  console.log('[ARABIC] Loading Arabic movies & TV...');
  try {
    const movies = [], tv = [];
    const seen_m = new Set(), seen_t = new Set();

    // Fetch Arabic movies — well-known only (vote_count >= 5 filters out indie/unknown)
    for (const sort of ['popularity.desc', 'vote_count.desc']) {
      for (const p of [1, 2, 3, 4, 5]) {
        try {
          const d = await tmdb(`/discover/movie?with_original_language=ar&with_origin_country=${ARABIC_COUNTRIES}&sort_by=${sort}&page=${p}&vote_count.gte=5&language=ar`);
          for (const m of (d.results || [])) {
            if (m.poster_path && m.title && !seen_m.has(m.id) && (m.vote_count || 0) >= 5) {
              seen_m.add(m.id);
              movies.push(m);
            }
          }
        } catch (e) {}
      }
    }

    // Fetch Arabic TV shows — well-known only
    for (const sort of ['popularity.desc', 'vote_count.desc']) {
      for (const p of [1, 2, 3, 4, 5]) {
        try {
          const d = await tmdb(`/discover/tv?with_original_language=ar&with_origin_country=${ARABIC_COUNTRIES}&sort_by=${sort}&page=${p}&vote_count.gte=3&language=ar`);
          for (const t of (d.results || [])) {
            if (t.poster_path && t.name && !seen_t.has(t.id) && (t.vote_count || 0) >= 3) {
              seen_t.add(t.id);
              tv.push(t);
            }
          }
        } catch (e) {}
      }
    }

    // Also add well-known Arabic TV shows by TMDB ID (variety shows, talent shows, talk shows)
    const KNOWN_TV_IDS = [
      60554,  // Arabs Got Talent
      62714,  // باب الحارة (Bab Al-Hara)
      76479,  // البرنامج (Al Bernameg)
      61740,  // Arab Idol
      87498,  // الهيبة (Al Hayba)
      93678,  // لعبة نيوتن (Newton's Cradle)
      95396,  // بالطو (Balto)
      67684,  // نسر الصعيد (Nesr El-Saeed)
      79531,  // أيوب (Ayoub)
      94949,  // الاختيار (The Choice)
      71138,  // Grand Hotel
      136218, // منزل 12 (House 12)
    ];
    for (const id of KNOWN_TV_IDS) {
      if (seen_t.has(id)) continue;
      try {
        const t = await tmdb(`/tv/${id}?language=ar`);
        if (t.poster_path && t.name) { seen_t.add(id); tv.push({ ...t, id }); }
      } catch (e) {}
    }

    // Also add well-known Arabic movies by TMDB ID
    const KNOWN_MOVIE_IDS = [
      313106, // عسل أسود (Black Honey)
      39513,  // الكيت كات (El Kit Kat)
      55424,  // عمارة يعقوبيان (The Yacoubian Building)
      263542, // الفيل الأزرق (The Blue Elephant)
      445651, // الفيل الأزرق 2
      42357,  // الجزيرة (The Island)
      330770, // الجزيرة 2
      310133, // ولاد العم (Cousin Friends)
      47574,  // إبراهيم الأبيض (Ibrahim El Abyad)
      362161, // كازابلانكا (Casablanca)
      34716,  // إسماعيلية رايح جاي
      27936,  // حين ميسرة
      189765, // لا مؤاخذة
      505948, // الممر (The Passage)
      458947, // تراب الماس (Diamond Dust)
      549053, // كيرة والجن (Cairo Conspiracy)
      615942, // واحد تاني (Someone Else)
      803820, // بيت الروبي (Beit El Ruby)
    ];
    for (const id of KNOWN_MOVIE_IDS) {
      if (seen_m.has(id)) continue;
      try {
        const m = await tmdb(`/movie/${id}?language=ar`);
        if (m.poster_path && m.title) { seen_m.add(id); movies.push({ ...m, id }); }
      } catch (e) {}
    }

    // Batch fetch English titles + production details for strict filtering
    const fetchEnTitle = async (item, type) => {
      try {
        const d = await tmdb(`/${type}/${item.id}?language=en`);
        item.enTitle = d.title || d.name || '';
        if (d.production_countries?.length) item.country = d.production_countries[0].iso_3166_1;
        if (d.original_language) item.original_language = d.original_language;
        if (d.origin_country?.length) item.origin_country = d.origin_country;
      } catch(e) { item.enTitle = ''; }
    };

    for (let i = 0; i < movies.length; i += 10) {
      await Promise.all(movies.slice(i, i + 10).map(m => fetchEnTitle(m, 'movie')));
    }
    for (let i = 0; i < tv.length; i += 10) {
      await Promise.all(tv.slice(i, i + 10).map(t => fetchEnTitle(t, 'tv')));
    }

    // STRICT FILTER: Only keep content with Arabic titles from target countries
    const ALLOWED_COUNTRIES = new Set(['EG','SY','LB','JO']);
    const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);
    const hasForeignScript = (s) => /[\u3000-\u9FFF\u4E00-\u9FFF\uAC00-\uD7AF\u0900-\u097F\u0400-\u04FF\u0E00-\u0E7F\u1100-\u11FF]/.test(s);
    
    const beforeM = movies.length, beforeT = tv.length;
    arabicCache.movies = movies.filter(m => {
      if (!hasArabic(m.title)) { console.log(`  [REJECT] No Arabic: "${m.title}" (${m.enTitle})`); return false; }
      if (hasForeignScript(m.title)) return false;
      if (m.original_language && m.original_language !== 'ar') { console.log(`  [REJECT] Lang=${m.original_language}: "${m.title}"`); return false; }
      if (m.country && !ALLOWED_COUNTRIES.has(m.country)) { console.log(`  [REJECT] Country=${m.country}: "${m.title}"`); return false; }
      return true;
    });
    arabicCache.tv = tv.filter(t => {
      if (!hasArabic(t.name)) { console.log(`  [REJECT] No Arabic: "${t.name}" (${t.enTitle})`); return false; }
      if (hasForeignScript(t.name)) return false;
      if (t.original_language && t.original_language !== 'ar') { console.log(`  [REJECT] Lang=${t.original_language}: "${t.name}"`); return false; }
      if (t.country && !ALLOWED_COUNTRIES.has(t.country)) { console.log(`  [REJECT] Country=${t.country}: "${t.name}"`); return false; }
      // Also check origin_country array for TV
      if (t.origin_country?.length && !t.origin_country.some(c => ALLOWED_COUNTRIES.has(c))) { console.log(`  [REJECT] Origin=${t.origin_country}: "${t.name}"`); return false; }
      return true;
    });
    arabicCache.ts = Date.now();
    console.log(`[ARABIC] Movies: ${beforeM} → ${arabicCache.movies.length}, TV: ${beforeT} → ${arabicCache.tv.length} after strict filtering`);
  } catch (e) {
    console.error('[ARABIC]', e.message);
    if (!arabicCache.movies) { arabicCache.movies = []; arabicCache.tv = []; }
  }
}

// Format titles
function arTitle(arName) { return arName; } // Arabic only for options
function arTitleFull(arName, enName) { // Arabic + English for reveal info
  if (enName && enName !== arName) return `${arName} (${enName})`;
  return arName;
}

// Check if title contains Arabic characters
function hasArabicChars(title) { return /[\u0600-\u06FF]/.test(title); }

// Get Arabic pool — ONLY titles with Arabic characters
function getArabicMoviePool(diff) {
  const all = (arabicCache.movies || []).filter(m => hasArabicChars(m.title));
  if (diff === 'easy') return all.filter(m => (m.popularity || 0) > 15 || (m.vote_count || 0) > 50);
  if (diff === 'hard') return all.filter(m => (m.popularity || 0) < 10);
  return all;
}
function getArabicTVPool(diff) {
  const all = (arabicCache.tv || []).filter(t => hasArabicChars(t.name));
  if (diff === 'easy') return all.filter(t => (t.popularity || 0) > 15 || (t.vote_count || 0) > 30);
  if (diff === 'hard') return all.filter(t => (t.popularity || 0) < 10);
  return all;
}

// Genre-matched wrong options — SAME TYPE only
function arabicWrong(correct, pool, titleField, count = 3) {
  const correctGenres = correct.genre_ids || [];
  const correctTitle = correct[titleField];
  const sameGenre = pool.filter(x => x.id !== correct.id && x[titleField] !== correctTitle && x.genre_ids?.some(g => correctGenres.includes(g)));
  const picked = shuffle(sameGenre).slice(0, count).map(x => arTitle(x[titleField]));
  if (picked.length < count) {
    const remaining = pool.filter(x => x.id !== correct.id && !picked.includes(arTitle(x[titleField])));
    picked.push(...shuffle(remaining).slice(0, count - picked.length).map(x => arTitle(x[titleField])));
  }
  return picked.slice(0, count);
}

// ═══ ROUND 1: Arabic Movie Poster ═══
async function genArabicMoviePosterQ(diff) {
  const pool = getArabicMoviePool(diff);
  if (pool.length < 4) return null;
  const m = pool[Math.floor(Math.random() * pool.length)];
  let img = await getTextlessPoster(m.id, 'movie');
  if (!img) img = `${TMDB_IMG}w780${m.poster_path}`;
  const answer = arTitle(m.title);
  const wrong = arabicWrong(m, pool, 'title');
  return {
    type: 'ar_movie_poster', category: 'أفلام عربية', question: 'ما هو هذا الفيلم العربي؟',
    hints: ['فيلم عربي من إنتاج ' + (COUNTRY_NAMES_AR[m.country] || 'العالم العربي'), 'سنة الإنتاج: ' + (m.release_date?.split('-')[0] || '؟'), 'تقييم: ' + (m.vote_average?.toFixed(1) || '؟') + ' / 10'],
    image: img, revealImage: `${TMDB_IMG}w780${m.poster_path}`,
    answer, options: shuffle([answer, ...wrong]),
    year: m.release_date?.split('-')[0] || '', info: arTitleFull(m.title, m.enTitle), landscape: false
  };
}

// ═══ ROUND 2: Arabic TV Show Poster ═══
async function genArabicTVPosterQ(diff) {
  const pool = getArabicTVPool(diff);
  if (pool.length < 4) return null;
  const s = pool[Math.floor(Math.random() * pool.length)];
  let img = await getTextlessPoster(s.id, 'tv');
  if (!img) img = `${TMDB_IMG}w780${s.poster_path}`;
  const answer = arTitle(s.name);
  const wrong = arabicWrong(s, pool, 'name');
  return {
    type: 'ar_tv_poster', category: 'مسلسلات عربية', question: 'ما هو هذا المسلسل العربي؟',
    hints: ['مسلسل عربي من إنتاج ' + (COUNTRY_NAMES_AR[s.country] || 'العالم العربي'), 'سنة العرض الأول: ' + (s.first_air_date?.split('-')[0] || '؟'), 'تقييم: ' + (s.vote_average?.toFixed(1) || '؟') + ' / 10'],
    image: img, revealImage: `${TMDB_IMG}w780${s.poster_path}`,
    answer, options: shuffle([answer, ...wrong]),
    year: s.first_air_date?.split('-')[0] || '', info: arTitleFull(s.name, s.enTitle), landscape: false
  };
}

// ═══ ROUND 3: Shared Cast ═══
async function genArabicSharedCastQ(diff) {
  const moviePool = getArabicMoviePool(diff).map(m => ({id:m.id,type:'movie',title:m.title,enTitle:m.enTitle,genre_ids:m.genre_ids,poster:`${TMDB_IMG}w780${m.poster_path}`,isMovie:true}));
  const tvPool = getArabicTVPool(diff).map(t => ({id:t.id,type:'tv',title:t.name,enTitle:t.enTitle,genre_ids:t.genre_ids,poster:`${TMDB_IMG}w780${t.poster_path}`,isMovie:false}));
  const allWorks = [...moviePool, ...tvPool];
  for (const work of shuffle(allWorks).slice(0, 5)) {
    try {
      const credits = await tmdb(`/${work.type}/${work.id}/credits?language=ar`);
      if (!credits.cast?.length) continue;
      const withPhotos = credits.cast.filter(c => c.profile_path && c.name && hasArabicChars(c.name));
      if (withPhotos.length < 3) continue;
      const actors = withPhotos.slice(0, 3);
      const actorImages = actors.map(a => `${TMDB_IMG}h632${a.profile_path}`);
      const actorNames = actors.map(a => a.name);
      const answer = arTitle(work.title);
      const sameType = (work.isMovie ? moviePool : tvPool).filter(w => w.id !== work.id);
      const wrong = shuffle(sameType).slice(0, 3).map(w => arTitle(w.title));
      return {
        type: 'ar_shared_cast', category: 'عمل مشترك', question: 'ما هو العمل المشترك بين هؤلاء الممثلين؟',
        hints: [actorNames[0], actorNames[1], actorNames[2]],
        image: actorImages[0], actorImages, actorNames, revealImage: work.poster,
        answer, options: shuffle([answer, ...wrong]),
        year: '', info: arTitleFull(work.title, work.enTitle), landscape: true, noBlur: true
      };
    } catch (e) { continue; }
  }
  return genArabicMoviePosterQ(diff);
}

// ═══ ROUND 4: Arab Actor — Enhanced with Syrian, Jordanian, Lebanese actors ═══
// Cache for diverse actor pool with multiple photos
const actorPhotoCache = { actors: [], ts: 0, usedInCurrentRound: new Set() };

// Expanded list of popular Arab actors from Syria, Jordan, Lebanon, Egypt
const POPULAR_ARAB_ACTORS = [
  // Syrian Actors
  1091449, // تيم حسن (Tim Hassan)
  1221881, // باسم ياخور (Basem Yakhour)
  1283726, // سلاف فواخرجي (Sulaf Fawakherji)
  1091452, // جمال سليمان (Jamal Suliman)
  2231986, // كندة علوش (Kinda Alloush)
  1370715, // عابد فهد (Abed Fahed)
  1484270, // قصي خولي (Qusai Khouli)
  2362022, // نادين تحسين بيك (Nadine Tahseen Bek)
  1091450, // سلوم حداد (Salloum Haddad)
  1091454, // معتصم النهار (Moatasem Al-Nahar)
  1518822, // كاريس بشار (Karis Bashar)
  1091456, // مكسيم خليل (Maxim Khalil)
  2232037, // رشا رزق (Rasha Rizk)
  1335495, // سامر المصري (Samer Al-Masri)
  2232039, // جيانا عيد (Jiana Eid)
  
  // Jordanian Actors
  1090820, // إياد نصار (Eyad Nassar)
  84493,   // علي سليمان (Ali Suliman)
  1479956, // صبا مبارك (Saba Mubarak)
  2293405, // منذر رياحنة (Munther Rayahneh)
  2503678, // ماجد المصري (Maged El Masry)
  1515677, // راكين سعد (Rakeen Saad)
  2555604, // سوسن أرشيد (Sawsan Arsheed)
  
  // Lebanese Actors
  95747,   // نادين لبكي (Nadine Labaki)
  1479977, // نيكول سابا (Nicole Saba)
  1518824, // سيرين عبد النور (Cyrine Abdelnour)
  1091458, // راغدة (Raghda)
  73425,   // جوليا قصار (Julia Kassar)
  1535506, // يارا صبري (Yara Sabri)
  2232041, // وفاء الكيلاني (Wafa Al-Kilani)
  1335497, // قصي الخولي (Qusai Al-Khouli)
  2232043, // تقلا شمعون (Takla Chamoun)
  1091460, // كارمن لبس (Carmen Lebbos)
  1464915, // قمر خلف (Qamar Khalaf)
  2259142, // دانييلا رحمة (Daniella Rahme)
  
  // Egyptian Actors - Expanded
  77530,   // عادل إمام (Adel Imam)
  1091403, // محمد هنيدي (Mohamed Henedy)
  77525,   // أحمد حلمي (Ahmed Helmy)
  1091407, // أحمد السقا (Ahmed El Sakka)
  77524,   // منى زكي (Mona Zaki)
  1091410, // خالد الصاوي (Khaled El Sawy)
  77526,   // يسرا (Yousra)
  1091412, // نيللي كريم (Nelly Karim)
  77531,   // هند صبري (Hend Sabry)
  1091418, // خالد أبو النجا (Khaled Abol Naga)
  77529,   // محمود حميدة (Mahmoud Hemida)
  1091415, // ماجد الكدواني (Maged El Kedwany)
  77527,   // ليلى علوي (Laila Eloui)
  129813,  // نور الشريف (Nour El-Sherif)
  1335493, // يحيى الفخراني (Yahya El Fakharani)
  1091398, // محمود عبد العزيز (Mahmoud Abdel Aziz)
  1514996, // نبيلة عبيد (Nabila Ebeid)
  1091400, // سعاد حسني (Souad Hosny)
  1091428, // شريف منير (Sherif Mounir)
  1091430, // غادة عادل (Ghada Adel)
  2232033, // درة (Dorra)
  1091432, // ياسمين عبد العزيز (Yasmine Abdel Aziz)
  1091434, // أحمد رزق (Ahmed Rizk)
  1091436, // محمد سعد (Mohamed Saad)
  1091438, // إدوارد (Edward)
  1091440, // بشرى (Bushra)
  1091442, // كريم عبد العزيز (Karim Abdel Aziz)
  2232035, // منة فضالي (Menna Fadali)
  1091422, // أحمد عز (Ahmed Ezz)
  2259144, // آسر ياسين (Asser Yassin)
  1091424, // منة شلبي (Menna Shalaby)
  1091426, // أحمد داود (Ahmed Dawood)
  2259143, // أحمد مكي (Ahmed Mekky)
  1091420, // محمد رمضان (Mohamed Ramadan)
  77528,   // يسرا اللوزي (Yousra El Lozy)
];

// Load actor pool with multiple photos
async function loadActorPhotos() {
  if (actorPhotoCache.actors.length > 0 && Date.now() - actorPhotoCache.ts < 3600000) {
    return actorPhotoCache.actors;
  }
  
  console.log('[ACTORS] Loading diverse Arab actors with multiple photos...');
  const actors = [];
  
  for (const actorId of POPULAR_ARAB_ACTORS) {
    try {
      const person = await tmdb(`/person/${actorId}?language=ar`);
      if (!person.profile_path || !person.name || !hasArabicChars(person.name)) continue;
      
      // Fetch all available photos for this actor
      const images = await tmdb(`/person/${actorId}/images`);
      const photos = (images.profiles || [])
        .filter(p => p.file_path)
        .map(p => `${TMDB_IMG}h632${p.file_path}`)
        .slice(0, 10); // Get up to 10 different photos
      
      // Add default photo if no additional photos found
      if (photos.length === 0) {
        photos.push(`${TMDB_IMG}h632${person.profile_path}`);
      }
      
      actors.push({
        id: person.id,
        name: person.name,
        gender: person.gender,
        photos: photos
      });
    } catch (e) {
      // Skip actors that fail to load
    }
  }
  
  actorPhotoCache.actors = actors;
  actorPhotoCache.ts = Date.now();
  console.log(`[ACTORS] Loaded ${actors.length} actors with multiple photos`);
  return actors;
}

async function genArabicActorQ(diff) {
  // Load enhanced actor pool
  const enhancedActors = await loadActorPhotos();
  
  // Filter out actors already used in this round
  const availableActors = enhancedActors.filter(a => !actorPhotoCache.usedInCurrentRound.has(a.id));
  
  // Also get actors from top movies/TV (original behavior)
  const allMovies = [...(arabicCache.movies || [])].filter(m => hasArabicChars(m.title)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const allTV = [...(arabicCache.tv || [])].filter(t => hasArabicChars(t.name)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const topWorks = [...allMovies.slice(0, 20).map(m => ({id:m.id,type:'movie'})), ...allTV.slice(0, 20).map(t => ({id:t.id,type:'tv'}))];
  
  // First try to use an actor from the enhanced pool (not yet used)
  if (availableActors.length >= 4) {
    // Shuffle to ensure variety
    const shuffledActors = shuffle(availableActors);
    
    for (const actor of shuffledActors) {
      const gender = actor.gender;
      
      // CRITICAL: Get ONLY same-gender actors for the options (cannot mix male/female)
      const sameGenderAll = enhancedActors.filter(a => a.id !== actor.id && a.gender === gender);
      
      // STRICT: Must have at least 3 same-gender options, otherwise skip this actor
      if (sameGenderAll.length < 3) {
        console.log(`[ACTORS] Skipping ${actor.name} - not enough same-gender options (${sameGenderAll.length})`);
        continue;
      }
      
      // Pick a random photo from this actor's collection
      const selectedPhoto = actor.photos[Math.floor(Math.random() * actor.photos.length)];
      const wrongNames = shuffle(sameGenderAll).slice(0, 3).map(a => a.name);
      
      // Mark this actor as used in current round
      actorPhotoCache.usedInCurrentRound.add(actor.id);
      
      console.log(`[ACTORS] Selected ${actor.name} (${gender === 1 ? 'Female' : 'Male'}) - Options: ${wrongNames.join(', ')}`);
      
      return {
        type: 'ar_actor', category: 'ممثلين عرب',
        question: gender === 1 ? 'من هي هذه الممثلة العربية؟' : 'من هو هذا الممثل العربي؟',
        hints: [gender === 1 ? 'ممثلة عربية مشهورة' : 'ممثل عربي مشهور', 'من أشهر نجوم الشاشة العربية', 'ظهر في أعمال كثيرة'],
        image: selectedPhoto,
        revealImage: selectedPhoto,
        answer: actor.name,
        options: shuffle([actor.name, ...wrongNames]),
        year: '', info: actor.name, landscape: false
      };
    }
  }
  
  // Fallback to original logic (from movie/TV credits)
  for (const work of shuffle(topWorks).slice(0, 5)) {
    try {
      const credits = await tmdb(`/${work.type}/${work.id}/credits?language=ar`);
      if (!credits.cast?.length) continue;
      const validCast = credits.cast.filter(c => c.profile_path && c.name && hasArabicChars(c.name) && !actorPhotoCache.usedInCurrentRound.has(c.id));
      if (validCast.length < 4) continue;
      const actor = validCast[0];
      const gender = actor.gender;
      
      // CRITICAL: Get ONLY same-gender actors for the options (cannot mix male/female)
      const sameGender = validCast.filter(c => c.id !== actor.id && c.gender === gender);
      
      // STRICT: Must have at least 3 same-gender options, otherwise skip this actor
      if (sameGender.length < 3) {
        console.log(`[ACTORS] Fallback: Skipping ${actor.name} - not enough same-gender options`);
        continue;
      }
      
      let wrongNames = shuffle(sameGender).slice(0, 3).map(c => c.name);
      
      // Mark this actor as used
      actorPhotoCache.usedInCurrentRound.add(actor.id);
      
      console.log(`[ACTORS] Fallback selected ${actor.name} (${gender === 1 ? 'Female' : 'Male'})`);
      
      return {
        type: 'ar_actor', category: 'ممثلين عرب',
        question: gender === 1 ? 'من هي هذه الممثلة العربية؟' : 'من هو هذا الممثل العربي؟',
        hints: [gender === 1 ? 'ممثلة عربية مشهورة' : 'ممثل عربي مشهور', 'من أشهر نجوم الشاشة العربية', 'ظهر في أعمال كثيرة'],
        image: `${TMDB_IMG}h632${actor.profile_path}`, revealImage: `${TMDB_IMG}h632${actor.profile_path}`,
        answer: actor.name, options: shuffle([actor.name, ...wrongNames]),
        year: '', info: actor.name, landscape: false
      };
    } catch (e) { continue; }
  }
  return genArabicMoviePosterQ(diff);
}

// ═══ ROUND 5: Guess the Year ═══
function genArabicYearQ(diff) {
  const allWorks = [
    ...getArabicMoviePool(diff).filter(m => m.release_date).map(m => ({title:m.title,enTitle:m.enTitle,year:parseInt(m.release_date.split('-')[0]),poster:`${TMDB_IMG}w780${m.poster_path}`,id:m.id})),
    ...getArabicTVPool(diff).filter(t => t.first_air_date).map(t => ({title:t.name,enTitle:t.enTitle,year:parseInt(t.first_air_date.split('-')[0]),poster:`${TMDB_IMG}w780${t.poster_path}`,id:t.id}))
  ].filter(w => w.year > 1980 && w.year <= new Date().getFullYear());
  if (allWorks.length < 4) return genArabicMoviePosterQ(diff);
  const work = allWorks[Math.floor(Math.random() * allWorks.length)];
  const correctYear = work.year;
  const wrongYears = new Set();
  for (const off of shuffle([-4,-3,-2,-1,1,2,3,4,5])) { const wy = correctYear + off; if (wy > 1980 && wy <= new Date().getFullYear()) wrongYears.add(wy); if (wrongYears.size >= 3) break; }
  while (wrongYears.size < 3) { wrongYears.add(correctYear + wrongYears.size + 5); }
  const answer = String(correctYear);
  return {
    type: 'ar_year', category: 'في أي سنة؟', question: 'في أي سنة تم إنتاج هذا العمل؟',
    hints: [arTitleFull(work.title, work.enTitle), 'حاول تخمين سنة الإنتاج', 'انظر إلى الملصق بعناية'],
    image: work.poster, revealImage: work.poster,
    answer, options: shuffle([answer, ...[...wrongYears].map(String)]),
    year: answer, info: `${arTitleFull(work.title, work.enTitle)} — ${answer}`, landscape: false, noBlur: true
  };
}

// Arabic generators
const ARABIC_GENS = {
  ar_movie_poster: () => genArabicMoviePosterQ(currentDifficulty),
  ar_tv_poster: () => genArabicTVPosterQ(currentDifficulty),
  ar_shared_cast: () => genArabicSharedCastQ(currentDifficulty),
  ar_actor: () => genArabicActorQ(currentDifficulty),
  ar_year: () => genArabicYearQ(currentDifficulty)
};
Object.assign(GENS, ARABIC_GENS);


// ═══ FAMOUS PEOPLE CATEGORY ══════════════════════════
const famousPeopleCache = { people: [], usedInCurrentRound: new Set() };
const wikiImageCache = {};

// Fetch person's photo from Wikipedia API — free, no key, CORS-friendly thumbnails
async function getWikiImage(wikiTitle) {
  if (wikiImageCache[wikiTitle]) return wikiImageCache[wikiTitle];
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(wikiTitle)}&prop=pageimages&format=json&pithumbsize=600&origin=*`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PartyGame/1.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const pages = d.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (page?.thumbnail?.source) {
      wikiImageCache[wikiTitle] = page.thumbnail.source;
      return page.thumbnail.source;
    }
  } catch (e) {}
  return null;
}

// Fetch invention photo from Pexels (stock photos work great for objects)
async function getInventionImage(query) {
  if (wikiImageCache['inv_' + query]) return wikiImageCache['inv_' + query];
  const img = await searchImage(query);
  if (img) { wikiImageCache['inv_' + query] = img; return img; }
  return null;
}

// Famous People DB — wiki field is the exact Wikipedia article title
const FAMOUS_PEOPLE_DB = [
  // ═══ SCIENTISTS ═══
  { name: 'Albert Einstein', wiki: 'Albert_Einstein', field: 'Scientist', nationality: 'Germany', era: '1900s', achievement: 'Theory of Relativity', difficulty: 'easy', gender: 'male' },
  { name: 'Marie Curie', wiki: 'Marie_Curie', field: 'Scientist', nationality: 'Poland', era: '1900s', achievement: 'Radioactivity Research & Nobel Prize', difficulty: 'medium', gender: 'female' },
  { name: 'Isaac Newton', wiki: 'Isaac_Newton', field: 'Scientist', nationality: 'United Kingdom', era: '1600s', achievement: 'Laws of Motion & Gravity', difficulty: 'easy', gender: 'male' },
  { name: 'Nikola Tesla', wiki: 'Nikola_Tesla', field: 'Scientist', nationality: 'Serbia', era: '1900s', achievement: 'Alternating Current Electricity', difficulty: 'medium', gender: 'male' },
  { name: 'Stephen Hawking', wiki: 'Stephen_Hawking', field: 'Scientist', nationality: 'United Kingdom', era: '2000s', achievement: 'Black Hole Theory', difficulty: 'medium', gender: 'male' },
  { name: 'Ahmed Zewail', wiki: 'Ahmed_Zewail', field: 'Scientist', nationality: 'Egypt', era: '2000s', achievement: 'Femtochemistry Nobel Prize', difficulty: 'hard', gender: 'male' },
  { name: 'Ibn Sina', wiki: 'Avicenna', field: 'Scientist', nationality: 'Persia', era: '1000s', achievement: 'Canon of Medicine', difficulty: 'medium', gender: 'male' },
  { name: 'Charles Darwin', wiki: 'Charles_Darwin', field: 'Scientist', nationality: 'United Kingdom', era: '1800s', achievement: 'Theory of Evolution', difficulty: 'easy', gender: 'male' },
  { name: 'Galileo Galilei', wiki: 'Galileo_Galilei', field: 'Scientist', nationality: 'Italy', era: '1500s', achievement: 'Father of Modern Astronomy', difficulty: 'medium', gender: 'male' },
  { name: 'Al-Khwarizmi', wiki: 'Al-Khwarizmi', field: 'Scientist', nationality: 'Persia', era: '800s', achievement: 'Father of Algebra', difficulty: 'hard', gender: 'male' },
  { name: 'Ibn Al-Haytham', wiki: 'Ibn_al-Haytham', field: 'Scientist', nationality: 'Iraq', era: '1000s', achievement: 'Father of Optics', difficulty: 'hard', gender: 'male' },
  { name: 'Rosalind Franklin', wiki: 'Rosalind_Franklin', field: 'Scientist', nationality: 'United Kingdom', era: '1900s', achievement: 'DNA Structure Discovery', difficulty: 'hard', gender: 'female' },
  { name: 'Louis Pasteur', wiki: 'Louis_Pasteur', field: 'Scientist', nationality: 'France', era: '1800s', achievement: 'Pasteurization & Vaccines', difficulty: 'medium', gender: 'male' },
  { name: 'Thomas Edison', wiki: 'Thomas_Edison', field: 'Scientist', nationality: 'United States', era: '1800s', achievement: 'Invented the Light Bulb', difficulty: 'easy', gender: 'male' },

  // ═══ ATHLETES ═══
  { name: 'Lionel Messi', wiki: 'Lionel_Messi', field: 'Athlete', nationality: 'Argentina', era: '2000s', achievement: 'Football World Cup Champion', difficulty: 'easy', gender: 'male' },
  { name: 'Cristiano Ronaldo', wiki: 'Cristiano_Ronaldo', field: 'Athlete', nationality: 'Portugal', era: '2000s', achievement: 'Football All-Time Top Scorer', difficulty: 'easy', gender: 'male' },
  { name: 'Mohamed Salah', wiki: 'Mohamed_Salah', field: 'Athlete', nationality: 'Egypt', era: '2000s', achievement: 'Egyptian Football Star', difficulty: 'easy', gender: 'male' },
  { name: 'Muhammad Ali', wiki: 'Muhammad_Ali', field: 'Athlete', nationality: 'United States', era: '1900s', achievement: 'Greatest Boxer of All Time', difficulty: 'easy', gender: 'male' },
  { name: 'Usain Bolt', wiki: 'Usain_Bolt', field: 'Athlete', nationality: 'Jamaica', era: '2000s', achievement: 'Fastest Man in History', difficulty: 'easy', gender: 'male' },
  { name: 'Serena Williams', wiki: 'Serena_Williams', field: 'Athlete', nationality: 'United States', era: '2000s', achievement: 'Tennis Grand Slam Champion', difficulty: 'easy', gender: 'female' },
  { name: 'Michael Jordan', wiki: 'Michael_Jordan', field: 'Athlete', nationality: 'United States', era: '1900s', achievement: 'Basketball Legend', difficulty: 'easy', gender: 'male' },
  { name: 'Diego Maradona', wiki: 'Diego_Maradona', field: 'Athlete', nationality: 'Argentina', era: '1900s', achievement: 'Football Hand of God', difficulty: 'medium', gender: 'male' },
  { name: 'Pelé', wiki: 'Pelé', field: 'Athlete', nationality: 'Brazil', era: '1900s', achievement: 'Football King — 3 World Cups', difficulty: 'easy', gender: 'male' },
  { name: 'Roger Federer', wiki: 'Roger_Federer', field: 'Athlete', nationality: 'Switzerland', era: '2000s', achievement: 'Tennis Legend', difficulty: 'medium', gender: 'male' },
  { name: 'Michael Phelps', wiki: 'Michael_Phelps', field: 'Athlete', nationality: 'United States', era: '2000s', achievement: 'Most Olympic Gold Medals Ever', difficulty: 'medium', gender: 'male' },
  { name: 'Zinedine Zidane', wiki: 'Zinedine_Zidane', field: 'Athlete', nationality: 'France', era: '2000s', achievement: 'Football World Cup Winner', difficulty: 'medium', gender: 'male' },
  { name: 'Neymar', wiki: 'Neymar', field: 'Athlete', nationality: 'Brazil', era: '2000s', achievement: 'Brazilian Football Star', difficulty: 'easy', gender: 'male' },
  { name: 'Kobe Bryant', wiki: 'Kobe_Bryant', field: 'Athlete', nationality: 'United States', era: '2000s', achievement: 'Basketball Champion', difficulty: 'medium', gender: 'male' },

  // ═══ SINGERS/MUSICIANS ═══
  { name: 'Michael Jackson', wiki: 'Michael_Jackson', field: 'Singer', nationality: 'United States', era: '1900s', achievement: 'King of Pop', difficulty: 'easy', gender: 'male' },
  { name: 'Umm Kulthum', wiki: 'Umm_Kulthum', field: 'Singer', nationality: 'Egypt', era: '1900s', achievement: 'Voice of the East', difficulty: 'easy', gender: 'female' },
  { name: 'Fairuz', wiki: 'Fairuz', field: 'Singer', nationality: 'Lebanon', era: '1900s', achievement: 'Jewel of Lebanon', difficulty: 'medium', gender: 'female' },
  { name: 'Kadim Al Sahir', wiki: 'Kadim_Al_Sahir', field: 'Singer', nationality: 'Iraq', era: '2000s', achievement: 'Caesar of Arabic Song', difficulty: 'medium', gender: 'male' },
  { name: 'Beethoven', wiki: 'Ludwig_van_Beethoven', field: 'Composer', nationality: 'Germany', era: '1700s', achievement: 'Classical Music Genius', difficulty: 'easy', gender: 'male' },
  { name: 'Mozart', wiki: 'Wolfgang_Amadeus_Mozart', field: 'Composer', nationality: 'Austria', era: '1700s', achievement: 'Classical Music Prodigy', difficulty: 'easy', gender: 'male' },
  { name: 'Freddie Mercury', wiki: 'Freddie_Mercury', field: 'Singer', nationality: 'United Kingdom', era: '1900s', achievement: 'Queen Band Lead Singer', difficulty: 'easy', gender: 'male' },
  { name: 'Elvis Presley', wiki: 'Elvis_Presley', field: 'Singer', nationality: 'United States', era: '1900s', achievement: 'King of Rock and Roll', difficulty: 'easy', gender: 'male' },
  { name: 'Abdel Halim Hafez', wiki: 'Abdel_Halim_Hafez', field: 'Singer', nationality: 'Egypt', era: '1900s', achievement: 'Egyptian Romantic Singer', difficulty: 'medium', gender: 'male' },
  { name: 'Bob Marley', wiki: 'Bob_Marley', field: 'Singer', nationality: 'Jamaica', era: '1900s', achievement: 'Reggae Legend', difficulty: 'easy', gender: 'male' },
  { name: 'Adele', wiki: 'Adele', field: 'Singer', nationality: 'United Kingdom', era: '2000s', achievement: 'Grammy-Winning Singer', difficulty: 'easy', gender: 'female' },
  { name: 'Warda Al-Jazairia', wiki: 'Warda_Al-Jazairia', field: 'Singer', nationality: 'Algeria', era: '1900s', achievement: 'Algerian Rose of Song', difficulty: 'hard', gender: 'female' },
  { name: 'Whitney Houston', wiki: 'Whitney_Houston', field: 'Singer', nationality: 'United States', era: '1900s', achievement: 'Greatest Voice in Pop', difficulty: 'easy', gender: 'female' },
  { name: 'John Lennon', wiki: 'John_Lennon', field: 'Singer', nationality: 'United Kingdom', era: '1900s', achievement: 'Beatles Co-Founder', difficulty: 'medium', gender: 'male' },

  // ═══ WORLD LEADERS ═══
  { name: 'Nelson Mandela', wiki: 'Nelson_Mandela', field: 'Leader', nationality: 'South Africa', era: '1900s', achievement: 'Ended Apartheid in South Africa', difficulty: 'easy', gender: 'male' },
  { name: 'Mahatma Gandhi', wiki: 'Mahatma_Gandhi', field: 'Leader', nationality: 'India', era: '1900s', achievement: 'Led Indian Independence', difficulty: 'easy', gender: 'male' },
  { name: 'Winston Churchill', wiki: 'Winston_Churchill', field: 'Leader', nationality: 'United Kingdom', era: '1900s', achievement: 'Led Britain Through WWII', difficulty: 'medium', gender: 'male' },
  { name: 'Queen Elizabeth II', wiki: 'Elizabeth_II', field: 'Leader', nationality: 'United Kingdom', era: '2000s', achievement: 'Longest-Reigning British Monarch', difficulty: 'easy', gender: 'female' },
  { name: 'Gamal Abdel Nasser', wiki: 'Gamal_Abdel_Nasser', field: 'Leader', nationality: 'Egypt', era: '1900s', achievement: 'Egyptian President & Arab Nationalist', difficulty: 'medium', gender: 'male' },
  { name: 'King Hussein', wiki: 'Hussein_of_Jordan', field: 'Leader', nationality: 'Jordan', era: '1900s', achievement: 'Jordanian King & Peacemaker', difficulty: 'medium', gender: 'male' },
  { name: 'Martin Luther King Jr.', wiki: 'Martin_Luther_King_Jr.', field: 'Leader', nationality: 'United States', era: '1900s', achievement: 'Civil Rights Leader', difficulty: 'easy', gender: 'male' },
  { name: 'Abraham Lincoln', wiki: 'Abraham_Lincoln', field: 'Leader', nationality: 'United States', era: '1800s', achievement: 'Abolished Slavery in America', difficulty: 'easy', gender: 'male' },
  { name: 'Cleopatra', wiki: 'Cleopatra', field: 'Leader', nationality: 'Egypt', era: '0050 BC', achievement: 'Last Pharaoh of Egypt', difficulty: 'easy', gender: 'female' },
  { name: 'Saladin', wiki: 'Saladin', field: 'Leader', nationality: 'Syria', era: '1100s', achievement: 'Liberated Jerusalem', difficulty: 'medium', gender: 'male' },
  { name: 'Queen Rania', wiki: 'Queen_Rania_of_Jordan', field: 'Leader', nationality: 'Jordan', era: '2000s', achievement: 'Queen of Jordan & Humanitarian', difficulty: 'medium', gender: 'female' },
  { name: 'Napoleon Bonaparte', wiki: 'Napoleon', field: 'Leader', nationality: 'France', era: '1800s', achievement: 'French Emperor & Military Genius', difficulty: 'easy', gender: 'male' },
  { name: 'John F. Kennedy', wiki: 'John_F._Kennedy', field: 'Leader', nationality: 'United States', era: '1900s', achievement: 'US President During Cold War', difficulty: 'medium', gender: 'male' },

  // ═══ AUTHORS/WRITERS ═══
  { name: 'William Shakespeare', wiki: 'William_Shakespeare', field: 'Author', nationality: 'United Kingdom', era: '1500s', achievement: 'Greatest English Playwright', difficulty: 'easy', gender: 'male' },
  { name: 'Naguib Mahfouz', wiki: 'Naguib_Mahfouz', field: 'Author', nationality: 'Egypt', era: '1900s', achievement: 'Nobel Prize in Literature', difficulty: 'medium', gender: 'male' },
  { name: 'Ghassan Kanafani', wiki: 'Ghassan_Kanafani', field: 'Author', nationality: 'Palestine', era: '1900s', achievement: 'Palestinian Resistance Writer', difficulty: 'hard', gender: 'male' },
  { name: 'Khalil Gibran', wiki: 'Khalil_Gibran', field: 'Author', nationality: 'Lebanon', era: '1900s', achievement: 'Author of The Prophet', difficulty: 'medium', gender: 'male' },
  { name: 'Agatha Christie', wiki: 'Agatha_Christie', field: 'Author', nationality: 'United Kingdom', era: '1900s', achievement: 'Queen of Mystery Novels', difficulty: 'medium', gender: 'female' },

  // ═══ ARTISTS ═══
  { name: 'Pablo Picasso', wiki: 'Pablo_Picasso', field: 'Artist', nationality: 'Spain', era: '1900s', achievement: 'Cubism Founder', difficulty: 'easy', gender: 'male' },
  { name: 'Leonardo da Vinci', wiki: 'Leonardo_da_Vinci', field: 'Artist', nationality: 'Italy', era: '1400s', achievement: 'Painted the Mona Lisa', difficulty: 'easy', gender: 'male' },
  { name: 'Vincent van Gogh', wiki: 'Vincent_van_Gogh', field: 'Artist', nationality: 'Netherlands', era: '1800s', achievement: 'Painted Starry Night', difficulty: 'easy', gender: 'male' },
  { name: 'Frida Kahlo', wiki: 'Frida_Kahlo', field: 'Artist', nationality: 'Mexico', era: '1900s', achievement: 'Mexican Self-Portrait Artist', difficulty: 'medium', gender: 'female' },
  { name: 'Michelangelo', wiki: 'Michelangelo', field: 'Artist', nationality: 'Italy', era: '1400s', achievement: 'Painted the Sistine Chapel', difficulty: 'easy', gender: 'male' },

  // ═══ DIRECTORS ═══
  { name: 'Steven Spielberg', wiki: 'Steven_Spielberg', field: 'Director', nationality: 'United States', era: '2000s', achievement: 'Directed Schindler\'s List & Jurassic Park', difficulty: 'medium', gender: 'male' },
  { name: 'Youssef Chahine', wiki: 'Youssef_Chahine', field: 'Director', nationality: 'Egypt', era: '1900s', achievement: 'Pioneer of Egyptian Cinema', difficulty: 'hard', gender: 'male' },
  { name: 'Alfred Hitchcock', wiki: 'Alfred_Hitchcock', field: 'Director', nationality: 'United Kingdom', era: '1900s', achievement: 'Master of Suspense Films', difficulty: 'medium', gender: 'male' },

  // ═══ EXPLORERS ═══
  { name: 'Neil Armstrong', wiki: 'Neil_Armstrong', field: 'Explorer', nationality: 'United States', era: '1900s', achievement: 'First Man on the Moon', difficulty: 'easy', gender: 'male' },
  { name: 'Ibn Battuta', wiki: 'Ibn_Battuta', field: 'Explorer', nationality: 'Morocco', era: '1300s', achievement: 'Greatest Medieval Traveler', difficulty: 'medium', gender: 'male' },
  { name: 'Christopher Columbus', wiki: 'Christopher_Columbus', field: 'Explorer', nationality: 'Italy', era: '1400s', achievement: 'Discovered the Americas', difficulty: 'easy', gender: 'male' },
  { name: 'Marco Polo', wiki: 'Marco_Polo', field: 'Explorer', nationality: 'Italy', era: '1200s', achievement: 'Explored the Silk Road to China', difficulty: 'medium', gender: 'male' },
];

// Inventions DB — uses Pexels for object photos (works great for things, not people)
const INVENTIONS_DB = [
  { name: 'Thomas Edison', invention: 'Light Bulb', year: '1879', category: 'Technology', nationality: 'United States', searchQuery: 'light bulb glowing', difficulty: 'easy' },
  { name: 'Alexander Graham Bell', invention: 'Telephone', year: '1876', category: 'Communication', nationality: 'United States', searchQuery: 'vintage telephone', difficulty: 'easy' },
  { name: 'Wright Brothers', invention: 'Airplane', year: '1903', category: 'Transport', nationality: 'United States', searchQuery: 'vintage airplane flying', difficulty: 'easy' },
  { name: 'Karl Benz', invention: 'Automobile', year: '1886', category: 'Transport', nationality: 'Germany', searchQuery: 'vintage car automobile', difficulty: 'medium' },
  { name: 'Johannes Gutenberg', invention: 'Printing Press', year: '1440', category: 'Technology', nationality: 'Germany', searchQuery: 'old printing press', difficulty: 'medium' },
  { name: 'Abbas Ibn Firnas', invention: 'Flying Machine', year: '875', category: 'Transport', nationality: 'Al-Andalus', searchQuery: 'hang glider flying', difficulty: 'hard' },
  { name: 'Al-Jazari', invention: 'Mechanical Clock', year: '1206', category: 'Technology', nationality: 'Mesopotamia', searchQuery: 'antique mechanical clock gears', difficulty: 'hard' },
  { name: 'Tim Berners-Lee', invention: 'World Wide Web', year: '1989', category: 'Technology', nationality: 'United Kingdom', searchQuery: 'internet web browser', difficulty: 'medium' },
  { name: 'Alexander Fleming', invention: 'Penicillin', year: '1928', category: 'Medicine', nationality: 'United Kingdom', searchQuery: 'penicillin medicine pills', difficulty: 'medium' },
  { name: 'Nikola Tesla', invention: 'AC Motor', year: '1888', category: 'Technology', nationality: 'Serbia', searchQuery: 'electric motor coil', difficulty: 'medium' },
  { name: 'Guglielmo Marconi', invention: 'Radio', year: '1895', category: 'Communication', nationality: 'Italy', searchQuery: 'vintage radio antique', difficulty: 'medium' },
  { name: 'James Watt', invention: 'Steam Engine', year: '1769', category: 'Technology', nationality: 'United Kingdom', searchQuery: 'steam engine locomotive', difficulty: 'medium' },
  { name: 'Galileo Galilei', invention: 'Telescope', year: '1609', category: 'Science', nationality: 'Italy', searchQuery: 'telescope astronomy stars', difficulty: 'medium' },
  { name: 'Steve Jobs', invention: 'iPhone', year: '2007', category: 'Technology', nationality: 'United States', searchQuery: 'smartphone mobile phone', difficulty: 'easy' },
  { name: 'Henry Ford', invention: 'Assembly Line', year: '1913', category: 'Transport', nationality: 'United States', searchQuery: 'car factory assembly line', difficulty: 'medium' },
  { name: 'Louis Pasteur', invention: 'Pasteurization', year: '1864', category: 'Medicine', nationality: 'France', searchQuery: 'milk bottle dairy', difficulty: 'medium' },
  { name: 'Alfred Nobel', invention: 'Dynamite', year: '1867', category: 'Science', nationality: 'Sweden', searchQuery: 'mining explosion', difficulty: 'hard' },
  { name: 'Marie Curie', invention: 'Radium Discovery', year: '1898', category: 'Science', nationality: 'Poland', searchQuery: 'radiation laboratory', difficulty: 'medium' },
];

// Reuse existing searchImage function for famous people photos
const pexelsCache = {};

// Get difficulty pool
function getFamousPeoplePool(diff) {
  if (diff === 'easy') return FAMOUS_PEOPLE_DB.filter(p => p.difficulty === 'easy');
  if (diff === 'hard') return FAMOUS_PEOPLE_DB.filter(p => p.difficulty === 'hard');
  return FAMOUS_PEOPLE_DB; // medium = all
}

function getInventionsPool(diff) {
  if (diff === 'easy') return INVENTIONS_DB.filter(i => i.difficulty === 'easy');
  if (diff === 'hard') return INVENTIONS_DB.filter(i => i.difficulty === 'hard');
  return INVENTIONS_DB;
}

// Round 1: Guess the Famous Person
async function genFamousPersonQ(diff) {
  const pool = getFamousPeoplePool(diff);
  const available = pool.filter(p => !famousPeopleCache.usedInCurrentRound.has(p.name));
  
  if (available.length < 4) {
    famousPeopleCache.usedInCurrentRound.clear();
    return genFamousPersonQ(diff);
  }
  
  const person = available[Math.floor(Math.random() * available.length)];
  const image = await getWikiImage(person.wiki);
  
  // Get wrong options from same field
  const sameField = pool.filter(p => p.name !== person.name && p.field === person.field);
  const wrongOptions = shuffle(sameField).slice(0, 3).map(p => p.name);
  
  // Fallback if not enough same-field options
  while (wrongOptions.length < 3) {
    const others = pool.filter(p => p.name !== person.name && !wrongOptions.includes(p.name));
    if (others.length === 0) break;
    wrongOptions.push(others[Math.floor(Math.random() * others.length)].name);
  }
  
  famousPeopleCache.usedInCurrentRound.add(person.name);
  
  return {
    type: 'famous_person',
    category: 'Guess the Famous Person',
    question: 'Who is this famous person?',
    hints: [person.field, person.era, person.achievement],
    image: image || 'fallback',
    revealImage: image || 'fallback',
    answer: person.name,
    options: shuffle([person.name, ...wrongOptions]),
    year: '',
    info: `${person.name} — ${person.achievement}`,
    landscape: false
  };
}

// Round 2: Guess Their Nationality
async function genFamousNationalityQ(diff) {
  const pool = getFamousPeoplePool(diff);
  const available = pool.filter(p => !famousPeopleCache.usedInCurrentRound.has(p.name));
  
  if (available.length < 4) {
    famousPeopleCache.usedInCurrentRound.clear();
    return genFamousNationalityQ(diff);
  }
  
  const person = available[Math.floor(Math.random() * available.length)];
  const image = await getWikiImage(person.wiki);
  
  // Get wrong nationalities from same region
  const regions = {
    'Middle East': ['Egypt', 'Syria', 'Lebanon', 'Jordan', 'Palestine', 'Iraq', 'Saudi Arabia', 'Qatar'],
    'Europe': ['United Kingdom', 'Germany', 'France', 'Italy', 'Spain', 'Austria', 'Netherlands', 'Poland', 'Serbia'],
    'Americas': ['United States', 'Argentina', 'Jamaica', 'Brazil', 'Mexico'],
    'Africa': ['Egypt', 'South Africa', 'Morocco'],
    'Asia': ['India', 'Japan', 'China']
  };
  
  let region = 'Other';
  for (const [r, countries] of Object.entries(regions)) {
    if (countries.includes(person.nationality)) {
      region = r;
      break;
    }
  }
  
  const sameRegion = regions[region] || [];
  const wrongOptions = shuffle(sameRegion.filter(c => c !== person.nationality && c !== 'Israel')).slice(0, 3);
  
  // Fallback
  const fallbackCountries = ['United States', 'United Kingdom', 'France', 'Germany', 'Egypt', 'Spain'];
  while (wrongOptions.length < 3) {
    const country = fallbackCountries[Math.floor(Math.random() * fallbackCountries.length)];
    if (country !== person.nationality && !wrongOptions.includes(country)) {
      wrongOptions.push(country);
    }
  }
  
  famousPeopleCache.usedInCurrentRound.add(person.name);
  
  return {
    type: 'famous_nationality',
    category: 'Guess Their Nationality',
    question: 'What nationality is this person?',
    hints: [person.field, person.era, person.achievement],
    image: image || 'fallback',
    revealImage: image || 'fallback',
    answer: person.nationality,
    options: shuffle([person.nationality, ...wrongOptions]),
    year: '',
    info: `${person.name} is from ${person.nationality}`,
    landscape: false
  };
}

// Round 3: Guess Why They're Famous
async function genFamousForQ(diff) {
  const pool = getFamousPeoplePool(diff);
  const available = pool.filter(p => !famousPeopleCache.usedInCurrentRound.has(p.name));
  
  if (available.length < 4) {
    famousPeopleCache.usedInCurrentRound.clear();
    return genFamousForQ(diff);
  }
  
  const person = available[Math.floor(Math.random() * available.length)];
  const image = await getWikiImage(person.wiki);
  
  // Get wrong achievements from same field
  const sameField = pool.filter(p => p.name !== person.name && p.field === person.field);
  const wrongOptions = shuffle(sameField).slice(0, 3).map(p => p.achievement);
  
  // Fallback
  while (wrongOptions.length < 3) {
    const others = pool.filter(p => p.name !== person.name && !wrongOptions.includes(p.achievement));
    if (others.length === 0) break;
    wrongOptions.push(others[Math.floor(Math.random() * others.length)].achievement);
  }
  
  famousPeopleCache.usedInCurrentRound.add(person.name);
  
  return {
    type: 'famous_for',
    category: 'Guess Why They\'re Famous',
    question: `What is ${person.name} famous for?`,
    hints: [person.nationality, person.era, person.field],
    image: image || 'fallback',
    revealImage: image || 'fallback',
    answer: person.achievement,
    options: shuffle([person.achievement, ...wrongOptions]),
    year: '',
    info: `${person.name} — ${person.achievement}`,
    landscape: false
  };
}

// ═══ Round 4: Guess Who Said It — Famous Quotes ═══
const QUOTES_DB = [
  // Scientists
  { quote: 'Imagination is more important than knowledge.', person: 'Albert Einstein', field: 'Scientist', gender: 'male', difficulty: 'easy' },
  { quote: "I have not failed. I've just found 10,000 ways that won't work.", person: 'Thomas Edison', field: 'Scientist', gender: 'male', difficulty: 'easy' },
  { quote: 'If I have seen further, it is by standing on the shoulders of giants.', person: 'Isaac Newton', field: 'Scientist', gender: 'male', difficulty: 'medium' },
  { quote: 'Nothing in life is to be feared, it is only to be understood.', person: 'Marie Curie', field: 'Scientist', gender: 'female', difficulty: 'medium' },
  { quote: 'However difficult life may seem, there is always something you can do and succeed at.', person: 'Stephen Hawking', field: 'Scientist', gender: 'male', difficulty: 'medium' },
  { quote: 'The important thing is to never stop questioning.', person: 'Albert Einstein', field: 'Scientist', gender: 'male', difficulty: 'medium' },
  // Leaders
  { quote: 'Be the change you wish to see in the world.', person: 'Mahatma Gandhi', field: 'Leader', gender: 'male', difficulty: 'easy' },
  { quote: 'I have a dream.', person: 'Martin Luther King Jr.', field: 'Leader', gender: 'male', difficulty: 'easy' },
  { quote: 'Education is the most powerful weapon which you can use to change the world.', person: 'Nelson Mandela', field: 'Leader', gender: 'male', difficulty: 'easy' },
  { quote: 'We shall fight on the beaches, we shall never surrender.', person: 'Winston Churchill', field: 'Leader', gender: 'male', difficulty: 'medium' },
  { quote: "In the end, it's not the years in your life that count. It's the life in your years.", person: 'Abraham Lincoln', field: 'Leader', gender: 'male', difficulty: 'medium' },
  { quote: 'Ask not what your country can do for you, ask what you can do for your country.', person: 'John F. Kennedy', field: 'Leader', gender: 'male', difficulty: 'medium' },
  { quote: 'Impossible is a word to be found only in the dictionary of fools.', person: 'Napoleon Bonaparte', field: 'Leader', gender: 'male', difficulty: 'medium' },
  // Athletes
  { quote: 'Float like a butterfly, sting like a bee.', person: 'Muhammad Ali', field: 'Athlete', gender: 'male', difficulty: 'easy' },
  { quote: "I've failed over and over and over again in my life. And that is why I succeed.", person: 'Michael Jordan', field: 'Athlete', gender: 'male', difficulty: 'medium' },
  { quote: 'You have to fight to reach your dream.', person: 'Lionel Messi', field: 'Athlete', gender: 'male', difficulty: 'easy' },
  { quote: 'I am the greatest, I said that even before I knew I was.', person: 'Muhammad Ali', field: 'Athlete', gender: 'male', difficulty: 'medium' },
  // Singers
  { quote: 'One good thing about music, when it hits you, you feel no pain.', person: 'Bob Marley', field: 'Singer', gender: 'male', difficulty: 'easy' },
  // Authors
  { quote: 'All that glitters is not gold.', person: 'William Shakespeare', field: 'Author', gender: 'male', difficulty: 'easy' },
  { quote: 'To be, or not to be, that is the question.', person: 'William Shakespeare', field: 'Author', gender: 'male', difficulty: 'easy' },
  // Artists
  { quote: 'Every child is an artist. The problem is how to remain an artist once he grows up.', person: 'Pablo Picasso', field: 'Artist', gender: 'male', difficulty: 'medium' },
  { quote: 'I dream of painting and then I paint my dream.', person: 'Vincent van Gogh', field: 'Artist', gender: 'male', difficulty: 'medium' },
  // Arabic Figures
  { quote: '\u0627\u0644\u0623\u0645\u0645 \u0644\u0627 \u062a\u0645\u0648\u062a \u0628\u0627\u0644\u0647\u0632\u0627\u0626\u0645 \u0648\u0644\u0643\u0646\u0647\u0627 \u062a\u0645\u0648\u062a \u062d\u064a\u0646 \u062a\u0642\u0628\u0644 \u0627\u0644\u0647\u0632\u064a\u0645\u0629', person: 'Gamal Abdel Nasser', field: 'Leader', gender: 'male', difficulty: 'medium' },
  { quote: '\u0644\u0627 \u064a\u0648\u062c\u062f \u0625\u0646\u0633\u0627\u0646 \u0636\u0639\u064a\u0641 \u0628\u0644 \u064a\u0648\u062c\u062f \u0625\u0646\u0633\u0627\u0646 \u064a\u062c\u0647\u0644 \u0645\u0648\u0627\u0637\u0646 \u0642\u0648\u062a\u0647', person: 'Naguib Mahfouz', field: 'Author', gender: 'male', difficulty: 'medium' },
  { quote: '\u0627\u0644\u062d\u0631\u064a\u0629 \u0644\u0627 \u062a\u064f\u0639\u0637\u0649 \u0628\u0644 \u062a\u064f\u0624\u062e\u0630', person: 'Ghassan Kanafani', field: 'Author', gender: 'male', difficulty: 'hard' },
  { quote: '\u0623\u0639\u0637\u0646\u064a \u0645\u0633\u0631\u062d\u0627\u064b \u0623\u0639\u0637\u064a\u0643 \u0634\u0639\u0628\u0627\u064b \u0639\u0638\u064a\u0645\u0627\u064b', person: 'Khalil Gibran', field: 'Author', gender: 'male', difficulty: 'medium' },
  { quote: '\u0625\u0646 \u0627\u0644\u0639\u062f\u0627\u0644\u0629 \u0628\u062f\u0648\u0646 \u0642\u0648\u0629 \u062d\u0644\u0645\u060c \u0648\u0627\u0644\u0642\u0648\u0629 \u0628\u062f\u0648\u0646 \u0639\u062f\u0627\u0644\u0629 \u0637\u063a\u064a\u0627\u0646', person: 'Saladin', field: 'Leader', gender: 'male', difficulty: 'hard' },
  { quote: '\u0627\u0644\u0639\u0644\u0645 \u0641\u064a \u0627\u0644\u0635\u063a\u0631 \u0643\u0627\u0644\u0646\u0642\u0634 \u0639\u0644\u0649 \u0627\u0644\u062d\u062c\u0631', person: 'Ibn Sina', field: 'Scientist', gender: 'male', difficulty: 'hard' },
  { quote: '\u0644\u0648 \u0643\u0627\u0646 \u0627\u0644\u0641\u0642\u0631 \u0631\u062c\u0644\u0627\u064b \u0644\u0642\u062a\u0644\u062a\u0647', person: 'Umm Kulthum', field: 'Singer', gender: 'female', difficulty: 'medium' },
  // Explorers
  { quote: "That's one small step for man, one giant leap for mankind.", person: 'Neil Armstrong', field: 'Explorer', gender: 'male', difficulty: 'easy' },
];

async function genFamousQuoteQ(diff) {
  const pool = diff === 'easy' ? QUOTES_DB.filter(q => q.difficulty === 'easy') : diff === 'hard' ? QUOTES_DB.filter(q => q.difficulty === 'hard') : QUOTES_DB;
  const available = pool.filter(q => !famousPeopleCache.usedInCurrentRound.has(q.quote));
  if (available.length < 4) { famousPeopleCache.usedInCurrentRound.clear(); return genFamousQuoteQ(diff); }
  const q = available[Math.floor(Math.random() * available.length)];
  const sameFieldGender = pool.filter(x => x.person !== q.person && x.field === q.field && x.gender === q.gender);
  const allOthers = pool.filter(x => x.person !== q.person);
  let wrongNames = [...new Set(shuffle(sameFieldGender.length >= 3 ? sameFieldGender : allOthers).map(x => x.person))].filter(n => n !== q.person).slice(0, 3);
  while (wrongNames.length < 3) {
    const fb = FAMOUS_PEOPLE_DB.filter(p => p.name !== q.person && p.field === q.field && !wrongNames.includes(p.name));
    if (fb.length === 0) break;
    wrongNames.push(fb[Math.floor(Math.random() * fb.length)].name);
  }
  famousPeopleCache.usedInCurrentRound.add(q.quote);
  const isArabicQuote = /[\u0600-\u06FF]/.test(q.quote);
  return {
    type: 'famous_quote', category: 'Guess Who Said It', question: 'Who said this famous quote?',
    hints: [q.field, isArabicQuote ? 'Famous Arabic quote' : 'A famous quote', q.difficulty === 'easy' ? 'Very well known' : 'Think carefully'],
    image: null, revealImage: null, quoteText: q.quote, isArabicQuote,
    answer: q.person, options: shuffle([q.person, ...wrongNames]),
    year: '', info: q.person, landscape: true, noBlur: true, noImage: true
  };
}

// ═══ Round 5: Guess the Connection — 4 clue photos ═══
const CLUES_DB = [
  { person: 'Albert Einstein', field: 'Scientist', gender: 'male', difficulty: 'easy', clues: ['physics equation blackboard','space time universe','german flag','nobel prize medal'], clueHints: ['A genius equation','Space and time','Born in this country','Won this prize'] },
  { person: 'Lionel Messi', field: 'Athlete', gender: 'male', difficulty: 'easy', clues: ['football soccer ball','argentina flag','barcelona stadium','world cup trophy'], clueHints: ['His sport','His country','His first club','He won this'] },
  { person: 'Cristiano Ronaldo', field: 'Athlete', gender: 'male', difficulty: 'easy', clues: ['football soccer goal','portugal flag','real madrid stadium','number seven'], clueHints: ['His sport','His country','His famous club','His number'] },
  { person: 'Mohamed Salah', field: 'Athlete', gender: 'male', difficulty: 'easy', clues: ['football soccer ball','egypt pyramids','liverpool stadium','golden boot'], clueHints: ['His sport','His country','His club','His award'] },
  { person: 'Michael Jackson', field: 'Singer', gender: 'male', difficulty: 'easy', clues: ['microphone stage concert','moonwalk dance','grammy music award','glitter glove'], clueHints: ['His tool','His move','His awards','His accessory'] },
  { person: 'Nelson Mandela', field: 'Leader', gender: 'male', difficulty: 'easy', clues: ['prison bars cell','south africa flag','peace dove symbol','fist raised'], clueHints: ['27 years here','His country','His mission','His symbol'] },
  { person: 'Umm Kulthum', field: 'Singer', gender: 'female', difficulty: 'medium', clues: ['vintage microphone','egypt pyramids','dark sunglasses','arabic calligraphy'], clueHints: ['She sang into this','Her country','Her look','Her language'] },
  { person: 'Mahatma Gandhi', field: 'Leader', gender: 'male', difficulty: 'easy', clues: ['india flag','peace protest march','spinning wheel cotton','salt pile'], clueHints: ['His country','His method','His symbol','His famous march'] },
  { person: 'Leonardo da Vinci', field: 'Artist', gender: 'male', difficulty: 'easy', clues: ['mona lisa painting','italy flag','flying machine sketch','paint brush palette'], clueHints: ['His masterpiece','His country','His invention','His craft'] },
  { person: 'William Shakespeare', field: 'Author', gender: 'male', difficulty: 'easy', clues: ['theater stage curtain','quill pen ink','skull bones','england flag'], clueHints: ['His stage','His pen','His famous play','His country'] },
  { person: 'Cleopatra', field: 'Leader', gender: 'female', difficulty: 'easy', clues: ['egypt pyramids sphinx','snake cobra','golden crown jewels','nile river boat'], clueHints: ['Her kingdom','Her fate','Her power','Her river'] },
  { person: 'Neil Armstrong', field: 'Explorer', gender: 'male', difficulty: 'easy', clues: ['moon surface craters','rocket space launch','astronaut helmet','american flag usa'], clueHints: ['He walked here','His ride','His gear','His country'] },
  { person: 'Pablo Picasso', field: 'Artist', gender: 'male', difficulty: 'medium', clues: ['cubism abstract art','spain flag','paint palette colors','bull artwork'], clueHints: ['His style','His country','His tools','His subject'] },
  { person: 'Muhammad Ali', field: 'Athlete', gender: 'male', difficulty: 'easy', clues: ['boxing ring gloves','butterfly nature wings','olympic rings medal','american flag'], clueHints: ['His ring','Float like a...','His first win','His country'] },
  { person: 'Bob Marley', field: 'Singer', gender: 'male', difficulty: 'easy', clues: ['reggae guitar acoustic','jamaica flag green','dreadlocks hair','peace sign hand'], clueHints: ['His music','His island','His hair','His message'] },
  { person: 'Gamal Abdel Nasser', field: 'Leader', gender: 'male', difficulty: 'medium', clues: ['egypt flag','suez canal ship','microphone speech podium','military officer uniform'], clueHints: ['His country','He nationalized this','He gave many','His rank'] },
  { person: 'Marie Curie', field: 'Scientist', gender: 'female', difficulty: 'medium', clues: ['radiation symbol warning','science laboratory','poland flag','nobel prize medal'], clueHints: ['Her discovery','Her workplace','Her birthplace','She won two'] },
  { person: 'Fairuz', field: 'Singer', gender: 'female', difficulty: 'medium', clues: ['lebanon flag cedar','microphone vintage stage','sunrise morning sky','arabic music notes'], clueHints: ['Her country','Her voice','People hear her every...','Her genre'] },
  { person: 'Saladin', field: 'Leader', gender: 'male', difficulty: 'medium', clues: ['jerusalem old city','sword medieval weapon','eagle bird','crusade castle'], clueHints: ['He freed this city','His weapon','His symbol','He fought for these'] },
  { person: 'Khalil Gibran', field: 'Author', gender: 'male', difficulty: 'medium', clues: ['book open pages','lebanon cedar flag','painting canvas art','pen writing poetry'], clueHints: ['His medium','His homeland','He also did this','His poetry'] },
  { person: 'Naguib Mahfouz', field: 'Author', gender: 'male', difficulty: 'medium', clues: ['old cairo street alley','stack books novel','nobel prize gold','coffee cup arabic'], clueHints: ['His city','His craft','His honor','His writing spot'] },
  { person: 'Usain Bolt', field: 'Athlete', gender: 'male', difficulty: 'easy', clues: ['running track sprint','jamaica flag green yellow','lightning bolt electricity','olympic gold medal'], clueHints: ['His track','His island','His pose','His prize'] },
  { person: 'Serena Williams', field: 'Athlete', gender: 'female', difficulty: 'easy', clues: ['tennis racket ball','american flag usa','wimbledon trophy green','tennis court net'], clueHints: ['Her sport','Her country','Her title','Her court'] },
  { person: 'Stephen Hawking', field: 'Scientist', gender: 'male', difficulty: 'medium', clues: ['black hole space galaxy','wheelchair disability','stars universe cosmos','book physics science'], clueHints: ['His theory','His chair','What he studied','His bestseller'] },
  { person: 'King Hussein', field: 'Leader', gender: 'male', difficulty: 'medium', clues: ['jordan flag','peace handshake diplomacy','royal crown gold','desert wadi rum jordan'], clueHints: ['His kingdom','His mission','His title','His land'] },
  { person: 'Queen Rania', field: 'Leader', gender: 'female', difficulty: 'medium', clues: ['jordan flag','school children education','crown tiara jewels','children charity humanitarian'], clueHints: ['Her country','Her passion','Her symbol','Her work'] },
];

async function genFamousConnectionQ(diff) {
  const pool = diff === 'easy' ? CLUES_DB.filter(c => c.difficulty === 'easy') : diff === 'hard' ? CLUES_DB.filter(c => c.difficulty === 'hard') : CLUES_DB;
  const available = pool.filter(c => !famousPeopleCache.usedInCurrentRound.has(c.person));
  if (available.length < 4) { famousPeopleCache.usedInCurrentRound.clear(); return genFamousConnectionQ(diff); }
  const clue = available[Math.floor(Math.random() * available.length)];
  // Fetch 4 clue images from Pexels
  const clueImages = [];
  for (const q of clue.clues) {
    const img = await searchImage(q);
    clueImages.push(img || null);
  }
  // Wrong options: same field + same gender
  const sameFieldGender = FAMOUS_PEOPLE_DB.filter(p => p.name !== clue.person && p.field === clue.field && p.gender === clue.gender);
  let wrongNames = shuffle(sameFieldGender).slice(0, 3).map(p => p.name);
  while (wrongNames.length < 3) {
    const others = FAMOUS_PEOPLE_DB.filter(p => p.name !== clue.person && !wrongNames.includes(p.name));
    if (others.length === 0) break;
    wrongNames.push(others[Math.floor(Math.random() * others.length)].name);
  }
  famousPeopleCache.usedInCurrentRound.add(clue.person);
  const wikiTitle = FAMOUS_PEOPLE_DB.find(p => p.name === clue.person)?.wiki || clue.person.replace(/ /g, '_');
  return {
    type: 'famous_connection', category: 'Guess the Connection', question: 'Who do these clues point to?',
    hints: [clue.field, clue.clueHints[0], clue.clueHints[1]],
    image: clueImages[0], revealImage: await getWikiImage(wikiTitle),
    clueImages: clueImages, clueHints: clue.clueHints,
    answer: clue.person, options: shuffle([clue.person, ...wrongNames]),
    year: '', info: clue.person, landscape: true, noBlur: true
  };
}

// Famous People generators
const FAMOUS_GENS = {
  famous_person: () => genFamousPersonQ(currentDifficulty),
  famous_nationality: () => genFamousNationalityQ(currentDifficulty),
  famous_for: () => genFamousForQ(currentDifficulty),
  famous_quote: () => genFamousQuoteQ(currentDifficulty),
  famous_connection: () => genFamousConnectionQ(currentDifficulty)
};
Object.assign(GENS, FAMOUS_GENS);


async function genRound(type, n = 10) { 
  // Reset actor tracking when starting actor round
  if (type === 'ar_actor') {
    actorPhotoCache.usedInCurrentRound.clear();
    console.log('[ACTORS] Starting new round - reset tracking');
  }
  
  // Reset famous people tracking when starting any famous people round
  if (type.startsWith('famous_')) {
    famousPeopleCache.usedInCurrentRound.clear();
    console.log('[FAMOUS] Starting new round - reset tracking');
  }
  
  const qs = [], used = new Set(); 
  for (let i = 0; i < n; i++) { 
    let q, a = 0; 
    do { 
      a++; 
      q = await GENS[type](); 
    } while (used.has(normalize(q.answer)) && a < 30); 
    used.add(normalize(q.answer)); 
    qs.push(q); 
    console.log(`  [Q${i + 1}] ${q.answer}`); 
  } 
  return qs; 
}

// ═══ CONFIG ══════════════════════════════════════════
const DIFF = { easy: { timer: 45, startBlur: 28, startRadius: 7, blurDecayPower: 1.4 }, medium: { timer: 50, startBlur: 42, startRadius: 5, blurDecayPower: 1.7 }, hard: { timer: 60, startBlur: 60, startRadius: 3, blurDecayPower: 2.0 } };
const LABELS = {
  movie_posters: 'Movie Posters', tv_posters: 'TV Show Posters', movie_scenes: 'Movie Scenes', tv_scenes: 'TV Show Scenes', characters: 'Guess the Character',
  flag_country: 'Guess the Flag', flag_capital: 'Guess the Capital', flag_continent: 'Guess the Continent', flag_mapshape: 'Guess the Map Shape', flag_landmark: 'Guess the Landmark',
  ar_movie_poster: 'أفلام عربية', ar_tv_poster: 'مسلسلات عربية', ar_shared_cast: 'عمل مشترك', ar_actor: 'ممثلين عرب', ar_year: 'في أي سنة؟',
  famous_person: 'Guess the Famous Person', famous_nationality: 'Guess Their Nationality', famous_for: 'Guess Why They\'re Famous', famous_quote: 'Guess Who Said It', famous_connection: 'Guess the Connection'
};
const ICONS = {
  movie_posters: '🎬', tv_posters: '📺', movie_scenes: '🎞️', tv_scenes: '📡', characters: '🌟',
  flag_country: '🏳️', flag_capital: '🏛️', flag_continent: '🌍', flag_mapshape: '🗺️', flag_landmark: '🏰',
  ar_movie_poster: '🎬', ar_tv_poster: '📺', ar_shared_cast: '👥', ar_actor: '👤', ar_year: '📅',
  famous_person: '👤', famous_nationality: '🌍', famous_for: '⭐', famous_quote: '🗣️', famous_connection: '🔗'
};

const CATEGORIES = {
  movies_tv: { name: 'Movies & TV Shows', icon: '🎬', available: true, rounds: ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'] },
  arabic_tv: { name: 'Arabic Movies & TV', icon: '🎭', available: true, rounds: ['ar_movie_poster', 'ar_tv_poster', 'ar_shared_cast', 'ar_actor', 'ar_year'] },
  flags: { name: 'Flags & Countries', icon: '🚩', available: true, rounds: ['flag_country', 'flag_capital', 'flag_continent', 'flag_mapshape', 'flag_landmark'] },
  famous_people: { name: 'Famous People', icon: '👤', available: true, rounds: ['famous_person', 'famous_nationality', 'famous_for', 'famous_quote', 'famous_connection'] },
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

    // Load data for the selected category
    if (category === 'movies_tv') {
      await loadTMDB();
      if (!cache.movies?.length) return cb({ error: 'Cannot load movies. Check TMDB API key.' });
    } else if (category === 'flags') {
      await loadFlags();
      if (!flagCache.countries?.length) return cb({ error: 'Cannot load country data.' });
    } else if (category === 'arabic_tv') {
      await loadArabic();
      if (!arabicCache.movies?.length && !arabicCache.tv?.length) return cb({ error: 'Cannot load Arabic content.' });
    } else if (category === 'famous_people') {
      console.log('[FAMOUS] Using hardcoded famous people database');
      if (!PEXELS_KEY) console.log('[FAMOUS] Warning: No Pexels API key - images may be limited');
    }

    // Set difficulty for generators that need it
    currentDifficulty = difficulty || 'medium';

    const code = genCode(); const diff = DIFF[difficulty] || DIFF.medium;
    console.log(`[${code}] Generating ${cat.name} (${difficulty})...`);
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

    // Check if this player was previously in the game (rejoin)
    const existingEntry = Object.entries(r.players).find(([, p]) => p.name.toLowerCase() === playerName.toLowerCase());
    if (existingEntry) {
      const [oldSid, oldPlayer] = existingEntry;
      // Remove old socket entry, create new one with preserved score
      const preservedScore = oldPlayer.score;
      const wasMaster = oldPlayer.isMaster;
      delete r.players[oldSid];
      r.players[socket.id] = { name: playerName, score: preservedScore, connected: true, isMaster: wasMaster };
      if (wasMaster) r.masterId = socket.id;
      socket.join(code); socket.roomCode = code;
      const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
      io.to(code).emit('player-list-update', pl);
      console.log(`[${code}] ${playerName} rejoined (score: ${preservedScore})`);
      return cb({ ok: true, players: pl, categoryName: r.categoryName });
    }

    // New player joining
    if (r.state !== 'lobby') return cb({ error: 'Game already started' });
    if (Object.keys(r.players).length >= 8) return cb({ error: 'Room full' });
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

  // New game in same room - keeps players, resets scores
  socket.on('new-game', async ({ difficulty, category }, cb) => {
    const code = socket.roomCode; if (!code || !rooms[code]) return cb?.({ error: 'No room' });
    const r = rooms[code]; if (r.masterId !== socket.id) return cb?.({ error: 'Only master can restart' });
    const cat = CATEGORIES[category]; if (!cat || !cat.available) return cb?.({ error: 'Invalid category' });

    if (category === 'movies_tv') { await loadTMDB(); }
    else if (category === 'flags') { await loadFlags(); }
    else if (category === 'arabic_tv') { await loadArabic(); }
    currentDifficulty = difficulty || 'medium';

    const diff = DIFF[difficulty] || DIFF.medium;
    console.log(`[${code}] New game: ${cat.name} (${difficulty})`);
    const allQ = {}; for (const rd of cat.rounds) { allQ[rd] = await genRound(rd, 10); }
    r.diff = diff; r.diffName = difficulty; r.category = category; r.categoryName = cat.name;
    r.activeRounds = cat.rounds; r.allQ = allQ; r.state = 'lobby'; r.rIdx = 0; r.qIdx = 0; r.answers = {}; clearTimeout(r.qTimer);
    Object.values(r.players).forEach(p => { p.score = 0; });
    const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }));
    io.to(code).emit('new-game-ready', { categoryName: cat.name, players: pl });
    cb?.({ ok: true, categoryName: cat.name }); console.log(`[${code}] New game ready!`);
  });

  socket.on('play-again', () => { const code = socket.roomCode; if (!code || !rooms[code]) return; const r = rooms[code]; if (r.masterId !== socket.id) return; io.to(code).emit('game-reset'); clearTimeout(r.qTimer); delete rooms[code]; });

  socket.on('disconnect', () => {
    const code = socket.roomCode; if (!code || !rooms[code]) return; const r = rooms[code];
    if (socket.isHost) r.hostId = null;
    else if (r.players[socket.id]) { r.players[socket.id].connected = false; io.to(code).emit('player-list-update', Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster }))); if (r.state === 'question') { const c = Object.entries(r.players).filter(([, p]) => p.connected); if (c.every(([id]) => r.answers[id]) && c.length > 0) { clearTimeout(r.qTimer); setTimeout(() => reveal(r), 500); } } }
    if (Object.values(r.players).filter(p => p.connected).length === 0 && !r.hostId) setTimeout(() => { if (rooms[code] && Object.values(rooms[code].players).filter(p => p.connected).length === 0) delete rooms[code]; }, 300000);
  });
});

// ═══ GAME FLOW ═══════════════════════════════════════
function startRound(r) { r.state = 'round_intro'; const rt = r.activeRounds[r.rIdx]; io.to(r.code).emit('round-intro', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundType: rt, roundLabel: LABELS[rt], roundIcon: ICONS[rt], questionsCount: 10, musicTrack: r.rIdx % 4 }); setTimeout(() => { r.qIdx = 0; sendQ(r); }, 4000); }
function sendQ(r) { r.state = 'question'; r.answers = {}; const rt = r.activeRounds[r.rIdx], q = r.allQ[rt][r.qIdx]; r.qStart = Date.now(); const base = { questionNumber: r.qIdx + 1, totalQuestions: 10, roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, type: q.type, category: q.category, question: q.question, hints: q.hints || (q.hint ? [q.hint] : []), timer: r.diff.timer, options: q.options, landscape: q.landscape || false, noBlur: q.noBlur || false, lightBg: q.lightBg || false, noImage: q.noImage || false }; if (r.hostId) io.to(r.hostId).emit('question-start', { ...base, image: q.image, difficulty: r.diff, actorImages: q.actorImages || null, actorNames: q.actorNames || null, quoteText: q.quoteText || null, isArabicQuote: q.isArabicQuote || false, clueImages: q.clueImages || null, clueHints: q.clueHints || null }); Object.keys(r.players).forEach(sid => io.to(sid).emit('question-start', { ...base, quoteText: q.quoteText || null, isArabicQuote: q.isArabicQuote || false })); r.qTimer = setTimeout(() => reveal(r), r.diff.timer * 1000); }
function reveal(r) { r.state = 'question_reveal'; clearTimeout(r.qTimer); const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx]; const results = {}; Object.entries(r.answers).forEach(([sid, a]) => { const p = r.players[sid]; if (p) results[p.name] = a; }); Object.entries(r.players).forEach(([, p]) => { if (!results[p.name]) results[p.name] = { correct: false, points: 0, time: null, choice: null }; }); const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('question-reveal', { answer: q.answer, info: q.info, year: q.year, image: q.revealImage || q.image, results, leaderboard: pl, questionNumber: r.qIdx + 1, totalQuestions: 10 }); r.autoNext = setTimeout(() => { if (r.state === 'question_reveal') nextQ(r); }, 5000); }
function nextQ(r) { clearTimeout(r.autoNext); r.qIdx++; r.qIdx >= 10 ? roundResults(r) : sendQ(r); }
function roundResults(r) { r.state = 'round_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('round-results', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundLabel: LABELS[r.activeRounds[r.rIdx]], leaderboard: pl, isLastRound: r.rIdx + 1 >= r.activeRounds.length }); r.autoNext = setTimeout(() => { if (r.state === 'round_results') { r.rIdx++; r.qIdx = 0; r.rIdx >= r.activeRounds.length ? finalResults(r) : startRound(r); } }, 5000); }
function finalResults(r) { r.state = 'final_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('final-results', { leaderboard: pl }); }

setInterval(() => { Object.entries(rooms).forEach(([c, r]) => { if (Date.now() - r.created > 5400000) { clearTimeout(r.qTimer); delete rooms[c]; } }); }, 60000);
server.listen(PORT, () => { console.log(`\n🎮 Party Game on port ${PORT}`); if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') console.log('⚠️ Set TMDB_API_KEY!\n'); });
