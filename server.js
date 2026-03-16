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
async function tmdb(ep) { const url = `https://api.themoviedb.org/3${ep}${ep.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=en-US`; const r = await fetch(url); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); }

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

const FLAG_EASY = ['US','GB','FR','DE','IT','ES','JP','CN','BR','CA','AU','IN','MX','RU','KR','TR','EG','SA','AE','GR','NL','SE','NO','PL','AR','CO','CL','PT','ZA','NZ','IE','CH','AT','BE','DK','TH','ID','PH','VN','MY','SG','IL','JO','QA','KW','NG','KE','PK','BD'];
const FLAG_HARD_EXCLUDE = new Set(FLAG_EASY);

// Wikimedia Commons helper — convert filename to direct image URL
function wmc(filename, width = 800) {
  const f = filename.replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${width}`;
}

// Landmarks with Wikimedia Commons images
const LANDMARKS = {
  US:{name:'Statue of Liberty',img:wmc('Statue of Liberty 7.jpg')},
  GB:{name:'Big Ben',img:wmc('Clock Tower - Palace of Westminster, London - May 2007.jpg')},
  FR:{name:'Eiffel Tower',img:wmc('Tour Eiffel Wikimedia Commons (cropped).jpg')},
  DE:{name:'Brandenburg Gate',img:wmc('Brandenburger Tor abends.jpg')},
  IT:{name:'Colosseum',img:wmc('Colosseo 2020.jpg')},
  ES:{name:'Sagrada Familia',img:wmc('Sagrada Familia 8-12-21 (1).jpg')},
  JP:{name:'Mount Fuji',img:wmc('FujiSunriseKawworz.jpg')},
  CN:{name:'Great Wall of China',img:wmc('The Great Wall of China at Jinshanling-edit.jpg')},
  BR:{name:'Christ the Redeemer',img:wmc('Christ on Corcovado mountain.JPG')},
  CA:{name:'CN Tower',img:wmc('Toronto - ON - Toronto Harbourfront7.jpg')},
  AU:{name:'Sydney Opera House',img:wmc('Sydney Opera House, botanic gardens 1.jpg')},
  IN:{name:'Taj Mahal',img:wmc('Taj Mahal, Agra, India edit3.jpg')},
  MX:{name:'Chichen Itza',img:wmc('Chichen Itza 3.jpg')},
  RU:{name:'Saint Basil\'s Cathedral',img:wmc('Saint Basil\'s Cathedral in Moscow.jpg')},
  KR:{name:'Gyeongbokgung Palace',img:wmc('Gyeongbokgung-GessungJeon.jpg')},
  TR:{name:'Hagia Sophia',img:wmc('Hagia Sophia Mars 2013.jpg')},
  EG:{name:'Pyramids of Giza',img:wmc('All Gizah Pyramids.jpg')},
  SA:{name:'Kaaba',img:wmc('Kaaba at night.jpg')},
  AE:{name:'Burj Khalifa',img:wmc('Burj Khalifa.jpg')},
  GR:{name:'Parthenon',img:wmc('The Parthenon in Athens.jpg')},
  NL:{name:'Windmills of Kinderdijk',img:wmc('Kinderdijk-molens.jpg')},
  TH:{name:'Wat Arun',img:wmc('Wat Arun Bangkok Thailand.jpg')},
  ID:{name:'Borobudur',img:wmc('Borobudur-Nothwest-view.jpg')},
  PE:{name:'Machu Picchu',img:wmc('Machu Picchu, Peru.jpg')},
  JO:{name:'Petra',img:wmc('Al Khazneh.jpg')},
  KH:{name:'Angkor Wat',img:wmc('Ankor Wat temple.jpg')},
  MA:{name:'Hassan II Mosque',img:wmc('Mosque Hassan II.jpg')},
  CZ:{name:'Prague Castle',img:wmc('Prague castle night.jpg')},
  NP:{name:'Mount Everest',img:wmc('Mt. Everest from Gokyo Ri November 5, 2012 Cropped.jpg')},
  CH:{name:'Matterhorn',img:wmc('Matterhorn-EastAndNorthside-viewedFromZerm662.jpg')},
  PT:{name:'Tower of Belém',img:wmc('Belem Tower Lisbonne.jpg')},
  AT:{name:'Schönbrunn Palace',img:wmc('Wien - Schloss Schönbrunn.jpg')},
  HU:{name:'Hungarian Parliament',img:wmc('Parliament Building, Budapest, outside.jpg')},
  HR:{name:'Dubrovnik Old Town',img:wmc('Dubrovnik crop.jpg')},
  IS:{name:'Blue Lagoon',img:wmc('Blue Lagoon (geothermal spa) in Grindavík, Iceland.jpg')},
  SG:{name:'Marina Bay Sands',img:wmc('Marina Bay Sands in the evening - 20101120.jpg')},
  MY:{name:'Petronas Towers',img:wmc('Petronas Panorama II.jpg')},
  KW:{name:'Kuwait Towers',img:wmc('Kuwait towers.jpg')},
  QA:{name:'Museum of Islamic Art',img:wmc('Museum of Islamic Art, Doha, Qatar.jpg')},
  PK:{name:'Badshahi Mosque',img:wmc('Badshahi Mosque, Lahore I.jpg')},
  ZA:{name:'Table Mountain',img:wmc('Table Mountain DanieVDM.jpg')},
  SE:{name:'Stockholm Palace',img:wmc('Stockholm palace.jpg')},
  DK:{name:'Little Mermaid',img:wmc('Copenhague - La Sirenita.jpg')},
  IE:{name:'Cliffs of Moher',img:wmc('Cliffs of Moher.jpg')},
  FI:{name:'Helsinki Cathedral',img:wmc('Helsinki July 2013-27a.jpg')},
  LB:{name:'Baalbek',img:wmc('Baalbek - Temple of Bacchus.jpg')},
  PH:{name:'Chocolate Hills',img:wmc('Chocolate Hills overview.JPG')},
  VN:{name:'Ha Long Bay',img:wmc('Halong Bay.jpg')},
  NO:{name:'Geirangerfjord',img:wmc('Geirangerfjord from Flydalsjuvet, 2013 June.jpg')},
  BE:{name:'Grand Place',img:wmc('Grand-Place 1.jpg')},
  NZ:{name:'Milford Sound',img:wmc('Milford Sound (New Zealand).JPG')}
};

// Capital city images from Wikimedia Commons
const CAPITAL_IMAGES = {
  US:wmc('NYC wbread.jpg'),GB:wmc('City of London skyline from London City Hall - Oct 2008.jpg'),
  FR:wmc('Eiffelturm, Paris, Frankreich.jpg'),DE:wmc('Cityscape Berlin.jpg'),
  IT:wmc('Colosseum in Rome, Italy - April 2007.jpg'),ES:wmc('Madrid Skyline II.jpg'),
  JP:wmc('Skyscrapers of Shinjuku 2009 January.jpg'),CN:wmc('Beijing montage.png'),
  BR:wmc('Congresso Brasilia.jpg'),CA:wmc('Ottawa skyline.jpg'),
  AU:wmc('Canberra viewed from Mount Ainslie.jpg'),IN:wmc('India Gate in New Delhi 03-2016.jpg'),
  MX:wmc('Ciudad.de" México City- Pair of views.jpg'),RU:wmc('Moscow July 2011-16.jpg'),
  KR:wmc('Seoul (metropolitan area), South Korea - panoramio.jpg'),TR:wmc('Ankara Kocatepe Camii.jpg'),
  EG:wmc('Cairo From Tower of Cairo.jpg'),SA:wmc('Riyadh Skyline New.jpg'),
  AE:wmc('Abu Dhabi Skyline from Marina.jpg'),GR:wmc('Athens view from Acropolis 2017.jpg'),
  JO:wmc('Amman BW 0.JPG'),TH:wmc('Bangkok skytrain sunset.jpg'),
  AR:wmc('Buenos Aires Congreso.jpg'),NL:wmc('Amsterdam Canals - July 2006.jpg'),
  PT:wmc('Ponte 25 de Abril - Lisboa (Portugal).jpg'),CH:wmc('Bern luftbild.png'),
  SE:wmc('Stockholm gamlastan etc.jpg'),NO:wmc('Oslo (6139403453).jpg'),
  AT:wmc('Panorama Wien.jpg'),BE:wmc('BrusselsGrandPlace.jpg'),
  DK:wmc('Copenhagen - Denmark (9250023487).jpg'),PL:wmc('Warsaw 6-2.jpg'),
  IE:wmc('Dublin Skyline, 2022.jpg'),CZ:wmc('Prague Panorama - Oct 2010.jpg'),
  HU:wmc('Budapest Panorama Danube.jpg'),SG:wmc('1 Singapore city skyline 2010.jpg'),
  KW:wmc('Flickr - HuTect ShOts - Kuwait City.jpg'),QA:wmc('Doha skyline (12464834905).jpg'),
  PK:wmc('Islamabad Faisal Masjid.jpg'),ZA:wmc('Pretoria Union Buildings-001.jpg')
};

// Subtle hints per country — fun facts that don't give away the answer directly
const HINTS = {
  US:'Home to Hollywood and the Grand Canyon',GB:'This island nation invented football and afternoon tea',
  FR:'Famous for wine, cheese, and a revolution in 1789',DE:'Known for engineering, Oktoberfest, and autobahns',
  IT:'Shaped like a boot, famous for pasta and Renaissance art',ES:'Known for flamenco, tapas, and La Tomatina festival',
  JP:'Island nation famous for cherry blossoms and bullet trains',CN:'Has the world\'s largest population and longest wall',
  BR:'Largest country in South America, loves carnival and football',CA:'Second largest country by area, known for maple syrup',
  AU:'A continent and a country, home to kangaroos',IN:'World\'s largest democracy, birthplace of yoga',
  MX:'Famous for tacos, Day of the Dead, and ancient civilizations',RU:'Spans 11 time zones across two continents',
  KR:'Known for K-pop, kimchi, and advanced technology',TR:'Straddles two continents — Europe and Asia',
  EG:'Home to one of the oldest civilizations and the Nile River',SA:'Largest country in the Arabian Peninsula',
  AE:'A federation of seven emirates in the Persian Gulf',GR:'Birthplace of democracy, philosophy, and the Olympics',
  NL:'Famous for tulips, bicycles, and being below sea level',SE:'Known for IKEA, ABBA, and long summer nights',
  NO:'Land of fjords, Vikings, and the midnight sun',PL:'Known for pierogi, Chopin, and amber coastline',
  AR:'Famous for tango, steak, and Patagonia',JO:'Home to the Dead Sea and an ancient carved city',
  TH:'Known as the Land of Smiles',ID:'Archipelago nation with over 17,000 islands',
  SG:'A city-state known as the Lion City',MY:'Famous for its twin skyscrapers and diverse cuisine',
  CH:'Known for chocolate, watches, and neutrality',AT:'Birthplace of Mozart, famous for classical music',
  PT:'Birthplace of fado music and port wine',ZA:'Known as the Rainbow Nation',
  NZ:'Famous for kiwis, rugby, and stunning landscapes',IE:'Known as the Emerald Isle',
  DK:'Home of LEGO and Hans Christian Andersen',BE:'Famous for chocolate, waffles, and comic strips',
  IL:'A small nation at the crossroads of three continents',PK:'Home to K2, the world\'s second highest peak',
  KW:'A small oil-rich nation on the Persian Gulf',QA:'Host of the 2022 FIFA World Cup'
};

async function loadFlags() {
  if (flagCache.countries && Date.now() - flagCache.ts < 86400000) return;
  console.log('[FLAGS] Loading countries...');
  try {
    const r = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,capital,region,subregion');
    const data = await r.json();
    flagCache.countries = data.filter(c => c.cca2 && c.name?.common).map(c => ({
      code: c.cca2, name: c.name.common,
      capital: (c.capital && c.capital[0]) || 'N/A',
      region: c.region || 'Unknown', subregion: c.subregion || c.region || 'Unknown',
      flag: `https://flagcdn.com/w640/${c.cca2.toLowerCase()}.png`
    }));
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

function getHint(c) { return HINTS[c.code] || `Located in ${c.subregion}`; }

// Round 1: Guess the Flag — flag image (landscape), hint below
function genFlagCountryQ(diff) {
  const pool = getFlagPool(diff); const c = pool[Math.floor(Math.random() * pool.length)];
  return { type: 'flag_country', category: 'Guess the Flag', question: 'What country does this flag belong to?', hint: getHint(c), image: c.flag, revealImage: c.flag, answer: c.name, options: shuffle([c.name, ...flagWrong(c, pool)]), year: '', info: c.name, landscape: true };
}

// Round 2: Guess the Capital — show capital city photo
function genFlagCapitalQ(diff) {
  const pool = getFlagPool(diff).filter(c => c.capital !== 'N/A');
  const withImg = pool.filter(c => CAPITAL_IMAGES[c.code]);
  const src = withImg.length >= 4 ? withImg : pool;
  const c = src[Math.floor(Math.random() * src.length)];
  const img = CAPITAL_IMAGES[c.code] || c.flag;
  return { type: 'flag_capital', category: 'Guess the Capital', question: `What is the capital of ${c.name}?`, hint: getHint(c), image: img, revealImage: img, answer: c.capital, options: shuffle([c.capital, ...flagWrong(c, pool, 'capital')]), year: '', info: `${c.capital}, ${c.name}`, landscape: true };
}

// Round 3: Guess the Continent — flag image, hint
function genFlagContinentQ(diff) {
  const pool = getFlagPool(diff); const c = pool[Math.floor(Math.random() * pool.length)];
  const allRegions = [...new Set(pool.map(x => x.region))].filter(r => r !== c.region);
  return { type: 'flag_continent', category: 'Guess the Continent', question: 'What continent is this country in?', hint: `This country is called ${c.name}`, image: c.flag, revealImage: c.flag, answer: c.region, options: shuffle([c.region, ...shuffle(allRegions).slice(0, 3)]), year: '', info: `${c.name} — ${c.region}`, landscape: true };
}

// Round 4: Flag Challenge — show flag, harder pool, different hint
function genFlagChallengeQ(diff) {
  const pool = getFlagPool(diff); const c = pool[Math.floor(Math.random() * pool.length)];
  const hint = c.capital !== 'N/A' ? `Its capital starts with "${c.capital[0]}"` : `Located in ${c.subregion}`;
  return { type: 'flag_map', category: 'Flag Challenge', question: 'Which country does this flag represent?', hint: hint, image: c.flag, revealImage: c.flag, answer: c.name, options: shuffle([c.name, ...flagWrong(c, pool)]), year: '', info: `${c.name} — ${c.subregion}`, landscape: true };
}

// Round 5: Guess the Landmark — show landmark PHOTO (not flag)
function genFlagLandmarkQ(diff) {
  const pool = getFlagPool(diff).filter(c => LANDMARKS[c.code]);
  if (pool.length < 4) return genFlagCountryQ(diff);
  const c = pool[Math.floor(Math.random() * pool.length)];
  const lm = LANDMARKS[c.code];
  const wrongPool = shuffle(pool.filter(x => x.code !== c.code && LANDMARKS[x.code])).slice(0, 3);
  return { type: 'flag_landmark', category: 'Guess the Landmark', question: `Which famous landmark is in ${c.name}?`, hint: getHint(c), image: lm.img, revealImage: lm.img, answer: lm.name, options: shuffle([lm.name, ...wrongPool.map(x => LANDMARKS[x.code].name)]), year: '', info: `${lm.name} — ${c.name}`, landscape: true };
}

let currentDifficulty = 'medium';
const FLAG_GENS = {
  flag_country: () => genFlagCountryQ(currentDifficulty),
  flag_capital: () => genFlagCapitalQ(currentDifficulty),
  flag_continent: () => genFlagContinentQ(currentDifficulty),
  flag_map: () => genFlagChallengeQ(currentDifficulty),
  flag_landmark: () => genFlagLandmarkQ(currentDifficulty)
};
Object.assign(GENS, FLAG_GENS);

async function genRound(type, n = 10) { const qs = [], used = new Set(); for (let i = 0; i < n; i++) { let q, a = 0; do { a++; q = await GENS[type](); } while (used.has(normalize(q.answer)) && a < 30); used.add(normalize(q.answer)); qs.push(q); console.log(`  [Q${i + 1}] ${q.answer}`); } return qs; }

// ═══ CONFIG ══════════════════════════════════════════
const DIFF = { easy: { timer: 45, startBlur: 28, startRadius: 7, blurDecayPower: 1.4 }, medium: { timer: 50, startBlur: 42, startRadius: 5, blurDecayPower: 1.7 }, hard: { timer: 60, startBlur: 60, startRadius: 3, blurDecayPower: 2.0 } };
const LABELS = {
  movie_posters: 'Movie Posters', tv_posters: 'TV Show Posters', movie_scenes: 'Movie Scenes', tv_scenes: 'TV Show Scenes', characters: 'Guess the Character',
  flag_country: 'Guess the Flag', flag_capital: 'Guess the Capital', flag_continent: 'Guess the Continent', flag_map: 'Flag Challenge', flag_landmark: 'Guess the Landmark'
};
const ICONS = {
  movie_posters: '🎬', tv_posters: '📺', movie_scenes: '🎞️', tv_scenes: '📡', characters: '🌟',
  flag_country: '🏳️', flag_capital: '🏛️', flag_continent: '🌍', flag_map: '🗺️', flag_landmark: '🏰'
};

const CATEGORIES = {
  movies_tv: { name: 'Movies & TV Shows', icon: '🎬', available: true, rounds: ['movie_posters', 'tv_posters', 'movie_scenes', 'tv_scenes', 'characters'] },
  flags: { name: 'Flags & Countries', icon: '🚩', available: true, rounds: ['flag_country', 'flag_capital', 'flag_continent', 'flag_map', 'flag_landmark'] },
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
function sendQ(r) { r.state = 'question'; r.answers = {}; const rt = r.activeRounds[r.rIdx], q = r.allQ[rt][r.qIdx]; r.qStart = Date.now(); const base = { questionNumber: r.qIdx + 1, totalQuestions: 10, roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, type: q.type, category: q.category, question: q.question, hint: q.hint || '', timer: r.diff.timer, options: q.options, landscape: q.landscape || false }; if (r.hostId) io.to(r.hostId).emit('question-start', { ...base, image: q.image, difficulty: r.diff }); Object.keys(r.players).forEach(sid => io.to(sid).emit('question-start', base)); r.qTimer = setTimeout(() => reveal(r), r.diff.timer * 1000); }
function reveal(r) { r.state = 'question_reveal'; clearTimeout(r.qTimer); const q = r.allQ[r.activeRounds[r.rIdx]][r.qIdx]; const results = {}; Object.entries(r.answers).forEach(([sid, a]) => { const p = r.players[sid]; if (p) results[p.name] = a; }); Object.entries(r.players).forEach(([, p]) => { if (!results[p.name]) results[p.name] = { correct: false, points: 0, time: null, choice: null }; }); const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('question-reveal', { answer: q.answer, info: q.info, year: q.year, image: q.revealImage || q.image, results, leaderboard: pl, questionNumber: r.qIdx + 1, totalQuestions: 10 }); }
function nextQ(r) { r.qIdx++; r.qIdx >= 10 ? roundResults(r) : sendQ(r); }
function roundResults(r) { r.state = 'round_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('round-results', { roundNumber: r.rIdx + 1, totalRounds: r.activeRounds.length, roundLabel: LABELS[r.activeRounds[r.rIdx]], leaderboard: pl, isLastRound: r.rIdx + 1 >= r.activeRounds.length }); }
function finalResults(r) { r.state = 'final_results'; const pl = Object.values(r.players).map(p => ({ name: p.name, score: p.score, connected: p.connected, isMaster: p.isMaster })).sort((a, b) => b.score - a.score); io.to(r.code).emit('final-results', { leaderboard: pl }); }

setInterval(() => { Object.entries(rooms).forEach(([c, r]) => { if (Date.now() - r.created > 5400000) { clearTimeout(r.qTimer); delete rooms[c]; } }); }, 60000);
server.listen(PORT, () => { console.log(`\n🎮 Party Game on port ${PORT}`); if (!TMDB_KEY || TMDB_KEY === 'your_tmdb_api_key_here') console.log('⚠️ Set TMDB_API_KEY!\n'); });
