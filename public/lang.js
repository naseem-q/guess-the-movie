// ═══ LANGUAGE SYSTEM — standalone, no game logic changes ═══
// Load this file in index.html and host.html via <script src="/lang.js"></script>

const TRANSLATIONS = {
  // Main page
  create_game: { en: 'Create Game', ar: 'إنشاء لعبة' },
  join_game: { en: 'Join Game', ar: 'انضم للعبة' },
  your_name: { en: 'YOUR NAME', ar: 'اسمك' },
  enter_name: { en: 'Enter your name', ar: 'اكتب اسمك' },
  category: { en: 'CATEGORY', ar: 'الفئة' },
  difficulty: { en: 'DIFFICULTY', ar: 'الصعوبة' },
  easy: { en: 'Easy', ar: 'سهل' },
  medium: { en: 'Medium', ar: 'متوسط' },
  hard: { en: 'Hard', ar: 'صعب' },
  room_code: { en: 'ROOM CODE', ar: 'رمز الغرفة' },
  enter_code: { en: 'Enter 6-digit code', ar: 'ادخل الرمز المكون من 6 أرقام' },
  start_game: { en: '▶ Start Game', ar: '▶ ابدأ اللعبة' },
  waiting_host: { en: 'Open /host on TV to display the game!', ar: 'افتح /host على التلفزيون لعرض اللعبة!' },
  new_game: { en: '🔄 New Game (Same Room)', ar: '🔄 لعبة جديدة (نفس الغرفة)' },
  leave_room: { en: '🚪 Leave Room', ar: '🚪 مغادرة الغرفة' },
  coming_soon: { en: 'COMING SOON', ar: 'قريباً' },
  players: { en: 'Players', ar: 'اللاعبين' },
  waiting_players: { en: 'Waiting for players...', ar: '...بانتظار اللاعبين' },
  share: { en: 'Share', ar: 'مشاركة' },
  install: { en: 'Install', ar: 'تثبيت' },
  next: { en: '▶ Next', ar: '▶ التالي' },
  skip: { en: 'Skip ⏭', ar: 'تخطي ⏭' },
  correct: { en: 'Correct!', ar: '!صح' },
  wrong: { en: 'Wrong!', ar: '!غلط' },
  times_up: { en: "Time's up!", ar: '!انتهى الوقت' },
  final_results: { en: 'Final Results', ar: 'النتائج النهائية' },
  round_results: { en: 'Round Results', ar: 'نتائج الجولة' },
  winner: { en: '🏆 Winner!', ar: '🏆 !الفائز' },
  question_of: { en: 'Question {0} of {1}', ar: 'سؤال {0} من {1}' },
  round_of: { en: 'Round {0}/{1}', ar: 'الجولة {0}/{1}' },
  round_x_of_y: { en: 'ROUND {0} OF {1}', ar: 'الجولة {0} من {1}' },
  x_questions: { en: '{0} Questions', ar: '{0} أسئلة' },
  x_answered: { en: '{0}/{1} answered', ar: '{0}/{1} أجابوا' },
  disconnected: { en: 'Disconnected!', ar: '!انقطع الاتصال' },
  reconnecting: { en: 'Reconnecting...', ar: '...جاري إعادة الاتصال' },
  reconnected: { en: 'Reconnected!', ar: '!تم إعادة الاتصال' },
  loading: { en: 'Loading...', ar: '...جاري التحميل' },
  powered_by: { en: 'Powered by Naseem Q. All rights reserved', ar: 'من تطوير نسيم ق. جميع الحقوق محفوظة' },
  how_to_play: { en: 'How to Play', ar: 'كيف تلعب' },
  // Category names
  cat_movies_tv: { en: 'Movies & TV Shows', ar: 'أفلام ومسلسلات' },
  cat_arabic_tv: { en: 'Arabic Movies & TV', ar: 'أفلام ومسلسلات عربية' },
  cat_flags: { en: 'Flags & Countries', ar: 'أعلام ودول' },
  cat_famous_people: { en: 'Famous People', ar: 'مشاهير' },
  cat_football_clubs: { en: 'Football Clubs', ar: 'أندية كرة القدم' },
  cat_sports_players: { en: 'Sports Players', ar: 'لاعبين رياضيين' },
  // Help page (colloquial)
  help_title: { en: 'How to Play', ar: 'كيف تلعب؟' },
  help_step1: { en: 'Open the link on your phone', ar: 'افتح الرابط على تلفونك' },
  help_step2: { en: 'Enter your name and pick a category', ar: 'ادخل اسمك واختار الفئة يلي بتحبها' },
  help_step3: { en: 'Share the room code with friends', ar: 'شارك رمز الغرفة مع صحابك' },
  help_step4: { en: 'Open /host on a TV or laptop', ar: 'افتح /host على التلفزيون أو اللابتوب' },
  help_step5: { en: 'Answer fast to get more points!', ar: 'جاوب بسرعة عشان تاخد نقاط أكثر!' },
  help_scoring: { en: 'Answer quickly for bonus points — up to 1,000 per question!', ar: 'كل ما جاوبت أسرع، بتاخد نقاط أكثر — لحد 1,000 نقطة بالسؤال!' },
};

// Current language
let _lang = localStorage.getItem('game_lang') || 'en';

// Get translation
function t(key, ...args) {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  let text = entry[_lang] || entry.en || key;
  args.forEach((a, i) => { text = text.replace(`{${i}}`, a); });
  return text;
}

// Get current language
function getLang() { return _lang; }

// Text replacements — maps English text to translation keys
const TEXT_MAP = {
  'Create Game': 'create_game',
  'Join Game': 'join_game',
  'Your Name': 'your_name',
  'Enter your name': 'enter_name',
  'CATEGORY': 'category',
  'DIFFICULTY': 'difficulty',
  'Easy': 'easy',
  'Medium': 'medium',
  'Hard': 'hard',
  'ROOM CODE': 'room_code',
  'Enter 6-digit code': 'enter_code',
  '▶ Start Game': 'start_game',
  '🔄 New Game (Same Room)': 'new_game',
  '🚪 Leave Room': 'leave_room',
  'COMING SOON': 'coming_soon',
  'Players': 'players',
  'Waiting for players...': 'waiting_players',
  '▶ Next': 'next',
  'Skip ⏭': 'skip',
  'Final Results': 'final_results',
  'How to Play': 'how_to_play',
  'How to Play & Install': 'how_to_play',
  'Movies & TV Shows': 'cat_movies_tv',
  'Arabic Movies & TV': 'cat_arabic_tv',
  'Flags & Countries': 'cat_flags',
  'Famous People': 'cat_famous_people',
  'Football Clubs': 'cat_football_clubs',
  'Sports Players': 'cat_sports_players',
  'Loading...': 'loading',
};

// Store original text so we can switch back to English
const originalTexts = new Map();

function translatePage() {
  // Walk all text nodes and elements
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walk.nextNode()) {
    const el = walk.currentNode;
    
    // Skip script/style tags
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    
    // Handle input placeholders
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.placeholder) {
      if (!originalTexts.has(el)) originalTexts.set(el, { type: 'placeholder', text: el.placeholder });
      const orig = originalTexts.get(el).text;
      const key = TEXT_MAP[orig];
      if (key) el.placeholder = t(key);
      else if (_lang === 'en') el.placeholder = orig;
    }
    
    // Handle elements with direct text (no child elements with text)
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      const text = el.textContent.trim();
      if (!text) continue;
      if (!originalTexts.has(el)) originalTexts.set(el, { type: 'text', text: text });
      const orig = originalTexts.get(el).text;
      const key = TEXT_MAP[orig];
      if (key) el.textContent = t(key);
      else if (_lang === 'en') el.textContent = orig;
    }
    
    // Handle elements that contain emoji + text like "🎮 Create Game"
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      const text = el.textContent.trim();
      // Try matching without emoji prefix
      const noEmoji = text.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}❓]\s*/u, '');
      const emojiPrefix = text.substring(0, text.length - noEmoji.length);
      const key = TEXT_MAP[noEmoji];
      if (key && !TEXT_MAP[text]) {
        if (!originalTexts.has(el)) originalTexts.set(el, { type: 'text', text: text });
        el.textContent = emojiPrefix + t(key);
      }
    }
  }
  
  // Handle COMING SOON badges (they're often in spans)
  document.querySelectorAll('.coming-soon, [class*="coming"]').forEach(el => {
    if (el.textContent.trim() === 'COMING SOON' || el.textContent.trim() === 'قريباً') {
      el.textContent = t('coming_soon');
    }
  });
}

// Set language and update page
function setLang(newLang) {
  _lang = newLang;
  localStorage.setItem('game_lang', newLang);
  document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = newLang;
  if (newLang === 'ar') {
    document.body.style.fontFamily = "'Tajawal', 'Outfit', sans-serif";
  } else {
    document.body.style.fontFamily = "'Outfit', sans-serif";
  }
  // Translate all visible text
  translatePage();
  // Update toggle button
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = newLang === 'ar' ? 'EN' : 'عربي';
  // Fire custom event
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: newLang } }));
}

// Initialize on load
function initLang() {
  if (!document.getElementById('lang-toggle')) {
    const btn = document.createElement('button');
    btn.id = 'lang-toggle';
    btn.textContent = _lang === 'ar' ? 'EN' : 'عربي';
    btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#FFE66D;font-size:14px;font-weight:700;padding:6px 14px;border-radius:20px;cursor:pointer;backdrop-filter:blur(8px);font-family:Tajawal,Outfit,sans-serif;transition:all 0.2s';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,230,109,0.2)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.12)'; });
    btn.onclick = () => setLang(_lang === 'ar' ? 'en' : 'ar');
    document.body.appendChild(btn);
  }
  setLang(_lang);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLang);
} else {
  initLang();
}
