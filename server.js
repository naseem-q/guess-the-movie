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
function normalize(s) { return s.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]/g, ''); }
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

    // Fetch Arabic movies — all countries at once, just 3 pages per sort
    for (const sort of ['popularity.desc', 'vote_count.desc']) {
      for (const p of [1, 2, 3]) {
        try {
          const d = await tmdb(`/discover/movie?with_original_language=ar&with_origin_country=${ARABIC_COUNTRIES}&sort_by=${sort}&page=${p}&language=ar`);
          for (const m of (d.results || [])) {
            if (m.poster_path && m.title && !seen_m.has(m.id)) {
              seen_m.add(m.id);
              movies.push(m);
            }
          }
        } catch (e) {}
      }
    }

    // Fetch Arabic TV shows — same approach
    for (const sort of ['popularity.desc', 'vote_count.desc']) {
      for (const p of [1, 2, 3]) {
        try {
          const d = await tmdb(`/discover/tv?with_original_language=ar&with_origin_country=${ARABIC_COUNTRIES}&sort_by=${sort}&page=${p}&language=ar`);
          for (const t of (d.results || [])) {
            if (t.poster_path && t.name && !seen_t.has(t.id)) {
              seen_t.add(t.id);
              tv.push(t);
            }
          }
        } catch (e) {}
      }
    }

    // Batch fetch English titles — only for the items we got (parallel, max 10 at a time)
    const fetchEnTitle = async (item, type) => {
      try {
        const field = type === 'movie' ? 'title' : 'name';
        const d = await tmdb(`/${type}/${item.id}?language=en`);
        item.enTitle = d.title || d.name || '';
        // Also get production country
        if (d.production_countries?.length) item.country = d.production_countries[0].iso_3166_1;
      } catch(e) { item.enTitle = ''; }
    };

    // Fetch English titles in parallel batches of 10
    for (let i = 0; i < movies.length; i += 10) {
      await Promise.all(movies.slice(i, i + 10).map(m => fetchEnTitle(m, 'movie')));
    }
    for (let i = 0; i < tv.length; i += 10) {
      await Promise.all(tv.slice(i, i + 10).map(t => fetchEnTitle(t, 'tv')));
    }

    arabicCache.movies = movies;
    arabicCache.tv = tv;
    arabicCache.ts = Date.now();
    console.log(`[ARABIC] ${movies.length} movies, ${tv.length} TV shows loaded`);
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

// Get Arabic pool based on difficulty
function getArabicMoviePool(diff) {
  const all = arabicCache.movies || [];
  if (diff === 'easy') return all.filter(m => (m.popularity || 0) > 15 || (m.vote_count || 0) > 50);
  if (diff === 'hard') return all.filter(m => (m.popularity || 0) < 10);
  return all;
}
function getArabicTVPool(diff) {
  const all = arabicCache.tv || [];
  if (diff === 'easy') return all.filter(t => (t.popularity || 0) > 15 || (t.vote_count || 0) > 30);
  if (diff === 'hard') return all.filter(t => (t.popularity || 0) < 10);
  return all;
}

// Genre-matched wrong options for Arabic content
function arabicWrong(correct, pool, titleField, enField, count = 3) {
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
  const wrong = arabicWrong(m, pool, 'title', 'enTitle');
  return {
    type: 'ar_movie_poster', category: 'أفلام عربية', question: 'ما هو هذا الفيلم العربي؟',
    hints: ['فيلم عربي من إنتاج ' + (COUNTRY_NAMES_AR[m.country] || 'العالم العربي'),
            'سنة الإنتاج: ' + (m.release_date?.split('-')[0] || '؟'),
            'تقييم: ' + (m.vote_average?.toFixed(1) || '؟') + ' / 10'],
    image: img, revealImage: `${TMDB_IMG}w780${m.poster_path}`,
    answer, options: shuffle([answer, ...wrong]),
    year: m.release_date?.split('-')[0] || '', info: answer, landscape: false
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
  const wrong = arabicWrong(s, pool, 'name', 'enTitle');
  return {
    type: 'ar_tv_poster', category: 'مسلسلات عربية', question: 'ما هو هذا المسلسل العربي؟',
    hints: ['مسلسل عربي من إنتاج ' + (COUNTRY_NAMES_AR[s.country] || 'العالم العربي'),
            'سنة العرض الأول: ' + (s.first_air_date?.split('-')[0] || '؟'),
            'تقييم: ' + (s.vote_average?.toFixed(1) || '؟') + ' / 10'],
    image: img, revealImage: `${TMDB_IMG}w780${s.poster_path}`,
    answer, options: shuffle([answer, ...wrong]),
    year: s.first_air_date?.split('-')[0] || '', info: answer, landscape: false
  };
}

// ═══ ROUND 3: Shared Cast — 3 actors, guess the movie/show ═══
async function genArabicSharedCastQ(diff) {
  const allWorks = [...getArabicMoviePool(diff).map(m => ({id:m.id,type:'movie',title:m.title,enTitle:m.enTitle,genre_ids:m.genre_ids,poster:`${TMDB_IMG}w780${m.poster_path}`})),
                    ...getArabicTVPool(diff).map(t => ({id:t.id,type:'tv',title:t.name,enTitle:t.enTitle,genre_ids:t.genre_ids,poster:`${TMDB_IMG}w780${t.poster_path}`}))];
  
  for (const work of shuffle(allWorks).slice(0, 5)) {
    try {
      const credits = await tmdb(`/${work.type}/${work.id}/credits?language=ar`);
      if (!credits.cast?.length) continue;
      const withPhotos = credits.cast.filter(c => c.profile_path && c.name);
      if (withPhotos.length < 3) continue;
      
      const actors = withPhotos.slice(0, 3);
      const actorImages = actors.map(a => `${TMDB_IMG}h632${a.profile_path}`);
      const actorNames = actors.map(a => a.name);
      
      const answer = arTitle(work.title);
      // Wrong options from other works
      const wrongWorks = shuffle(allWorks.filter(w => w.id !== work.id)).slice(0, 3);
      const wrong = wrongWorks.map(w => arTitle(w.title));
      
      return {
        type: 'ar_shared_cast', category: 'عمل مشترك',
        question: 'ما هو العمل المشترك بين هؤلاء الممثلين؟',
        hints: [actorNames[0], actorNames[1], actorNames[2]],
        image: actorImages[0], // Primary image
        actorImages: actorImages, // All 3 images — host will display specially
        actorNames: actorNames,
        revealImage: work.poster,
        answer, options: shuffle([answer, ...wrong]),
        year: '', info: answer, landscape: true, noBlur: true
      };
    } catch (e) { continue; }
  }
  
  // Fallback to movie poster question
  return genArabicMoviePosterQ(diff);
}

// ═══ ROUND 4: Arab Actor — guess who — pick from MOST POPULAR works ═══
async function genArabicActorQ(diff) {
  // Sort by popularity — most popular first so we get famous actors
  const allMovies = [...(arabicCache.movies || [])].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const allTV = [...(arabicCache.tv || [])].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  // Take top 30 most popular works
  const topWorks = [...allMovies.slice(0, 15).map(m => ({id:m.id,type:'movie'})),
                    ...allTV.slice(0, 15).map(t => ({id:t.id,type:'tv'}))];
  
  const actorsSeen = new Set();
  for (const work of shuffle(topWorks).slice(0, 5)) {
    try {
      const credits = await tmdb(`/${work.type}/${work.id}/credits?language=ar`);
      if (!credits.cast?.length) continue;
      
      // Pick lead actors (first 3 in cast list — most famous)
      for (const actor of credits.cast.filter(c => c.profile_path && c.name && !actorsSeen.has(c.id)).slice(0, 3)) {
        actorsSeen.add(actor.id);
        const others = credits.cast.filter(c => c.name && c.id !== actor.id && c.name.length > 2).map(c => c.name);
        if (others.length < 3) continue;
        
        return {
          type: 'ar_actor', category: 'ممثلين عرب',
          question: 'من هو هذا الممثل العربي؟',
          hints: ['ممثل عربي مشهور', 'من أشهر نجوم الشاشة العربية', 'ظهر في أعمال كثيرة'],
          image: `${TMDB_IMG}h632${actor.profile_path}`,
          revealImage: `${TMDB_IMG}h632${actor.profile_path}`,
          answer: actor.name,
          options: shuffle([actor.name, ...shuffle(others).slice(0, 3)]),
          year: '', info: actor.name, landscape: false
        };
      }
    } catch (e) { continue; }
  }
  
  return genArabicMoviePosterQ(diff);
}

// ═══ ROUND 5: Guess the Year ═══
function genArabicYearQ(diff) {
  const allWorks = [
    ...getArabicMoviePool(diff).filter(m => m.release_date).map(m => ({title:m.title,enTitle:m.enTitle,year:parseInt(m.release_date.split('-')[0]),poster:`${TMDB_IMG}w780${m.poster_path}`,genre_ids:m.genre_ids,id:m.id})),
    ...getArabicTVPool(diff).filter(t => t.first_air_date).map(t => ({title:t.name,enTitle:t.enTitle,year:parseInt(t.first_air_date.split('-')[0]),poster:`${TMDB_IMG}w780${t.poster_path}`,genre_ids:t.genre_ids,id:t.id}))
  ].filter(w => w.year > 1980 && w.year <= new Date().getFullYear());
  
  if (allWorks.length < 4) return genArabicMoviePosterQ(diff);
  
  const work = allWorks[Math.floor(Math.random() * allWorks.length)];
  const correctYear = work.year;
  
  // Generate 3 wrong years within ±1-5 years range
  const wrongYears = new Set();
  const offsets = shuffle([-4, -3, -2, -1, 1, 2, 3, 4, 5]);
  for (const off of offsets) {
    const wy = correctYear + off;
    if (wy > 1980 && wy <= new Date().getFullYear() && wy !== correctYear) wrongYears.add(wy);
    if (wrongYears.size >= 3) break;
  }
  // Fill if needed
  while (wrongYears.size < 3) { wrongYears.add(correctYear + wrongYears.size + 5); }
  
  const answer = String(correctYear);
  const wrong = [...wrongYears].map(String);
  
  return {
    type: 'ar_year', category: 'في أي سنة؟',
    question: 'في أي سنة تم إنتاج هذا العمل؟',
    hints: [arTitleFull(work.title, work.enTitle), 'حاول تخمين سنة الإنتاج', 'انظر إلى الملصق بعناية'],
    image: work.poster, revealImage: work.poster,
    answer, options: shuffle([answer, ...wrong]),
    year: answer, info: `${arTitleFull(work.title, work.enTitle)} — ${answer}`,
    landscape: false, noBlur: true
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

async function genRound(type, n = 10) { const qs = [], used = new Set(); for (let i = 0; i < n; i++) { let q, a = 0; do { a++; q = await GENS[type](); } while (used.has(normalize(q.answer)) && a < 30); used.add(normalize(q.answer)); qs.push(q); console.log(`  [Q${i + 1}] ${q.answer}`); } return qs; }

// ═══ CONFIG ══════════════════════════════════════════
const DIFF = { easy: { timer: 45, startBlur: 28, startRadius: 7, blurDecayPower: 1.4 }, medium: { timer: 50, startBlur: 42, startRadius: 5, blurDecayPower: 1.7 }, hard: { timer: 60, startBlur: 60, startRadius: 3, blurDecayPower: 2.0 } };
const LABELS = {
  movie_posters: 'Movie Posters', tv_posters: 'TV Show Posters', movie_scenes: 'Movie Scenes', tv_scenes: 'TV Show Scenes', characters: 'Guess the Character',
  flag_country: 'Guess the Flag', flag_capital: 'Guess the Capital', flag_continent: 'Guess the Continent', flag_mapshape: 'Guess the Map Shape', flag_landmark: 'Guess the Landmark',
  ar_movie_poster: 'أفلام عربية', ar_tv_poster: 'مسلسلات عربية', ar_shared_cast: 'عمل مشترك', ar_actor: 'ممثلين عرب', ar_year: 'في أي سنة؟'
};
const ICONS = {
  movie_posters: '🎬', tv_posters: '📺', movie_scenes: '🎞️', tv_scenes: '📡', characters: '🌟',
  flag_country: '🏳️', flag_capital: '🏛️', flag_continent: '🌍', flag_mapshape: '🗺️', flag_landmark: '🏰',
  ar_movie_poster: '🎬', ar_tv_poster: '📺', ar_shared_cast: '👥', ar_actor: '👤', ar_year: '📅'
};

const CATEGORIES = {
  movies_tv: { name: 'Movies & TV Shows', icon: '🎬', available: true, rounds: ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'] },
  arabic_tv: { name: 'Arabic Movies & TV', icon: '🎭', available: true, rounds: ['ar_movie_poster', 'ar_tv_poster', 'ar_shared_cast', 'ar_actor', 'ar_year'] },
  flags: { name: 'Flags & Countries', icon: '🚩', available: true, rounds: ['flag_country', 'flag_capital', 'flag_continent', 'flag_mapshape', 'flag_landmark'] },
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
function sendQ(r) { r.state = 'question'; r.answers = {}; const rt = r.activeRounds[r.rIdx], q = r.allQ[rt][r.qIdx]; r.qStart = Date.now(); const base = { questionNumber: r.qIdx + 1, totalQuestions: 10, roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, type: q.type, category: q.category, question: q.question, hints: q.hints || (q.hint ? [q.hint] : []), timer: r.diff.timer, options: q.options, landscape: q.landscape || false, noBlur: q.noBlur || false, lightBg: q.lightBg || false }; if (r.hostId) io.to(r.hostId).emit('question-start', { ...base, image: q.image, difficulty: r.diff, actorImages: q.actorImages || null, actorNames: q.actorNames || null }); Object.keys(r.players).forEach(sid => io.to(sid).emit('question-start', base)); r.qTimer = setTimeout(() => reveal(r), r.diff.timer * 1000); }
function reveal(r) { r.state = 'question_reveal'; clearTimeout(r.qTimer); const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx]; const results = {}; Object.entries(r.answers).forEach(([sid, a]) => { const p = r.players[sid]; if (p) results[p.name] = a; }); Object.entries(r.players).forEach(([, p]) => { if (!results[p.name]) results[p.name] = { correct: false, points: 0, time: null, choice: null }; }); const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('question-reveal', { answer: q.answer, info: q.info, year: q.year, image: q.revealImage || q.image, results, leaderboard: pl, questionNumber: r.qIdx + 1, totalQuestions: 10 }); }
function nextQ(r) { r.qIdx++; r.qIdx >= 10 ? roundResults(r) : sendQ(r); }
function roundResults(r) { r.state = 'round_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('round-results', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundLabel: LABELS[r.activeRounds[r.rIdx]], leaderboard: pl, isLastRound: r.rIdx + 1 >= r.activeRounds.length }); }
function finalResults(r) { r.state = 'final_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('final-results', { leaderboard: pl }); }

setInterval(() => { Object.entries(rooms).forEach(([c, r]) => { if (Date.now() - r.created > 5400000) { clearTimeout(r.qTimer); delete rooms[c]; } }); }, 60000);
server.listen(PORT, () => { console.log(`\n🎮 Party Game on port ${PORT}`); if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') console.log('⚠️ Set TMDB_API_KEY!\n'); });
