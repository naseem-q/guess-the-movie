// ═══ LANGUAGE SYSTEM v2 — translates all content, keeps LTR layout ═══
var _lang = localStorage.getItem('game_lang') || 'en';

var T = {
  'Create Game':'إنشاء لعبة','Join Game':'انضم للعبة','YOUR NAME':'اسمك','Your Name':'اسمك',
  'Enter your name':'اكتب اسمك','CATEGORY':'الفئة','DIFFICULTY':'الصعوبة',
  'Easy':'سهل','Medium':'متوسط','Hard':'صعب',
  'ROOM CODE':'رمز الغرفة','Enter 6-digit code':'ادخل رمز الغرفة',
  '▶ Start Game':'▶ ابدأ اللعبة',
  '🔄 New Game (Same Room)':'🔄 لعبة جديدة',
  '🚪 Leave Room':'🚪 مغادرة الغرفة',
  'COMING SOON':'قريباً','Players':'اللاعبين',
  'Waiting for players...':'بانتظار اللاعبين...',
  '▶ Next':'▶ التالي','Skip ⏭':'تخطي ⏭',
  'Final Results':'النتائج النهائية','Round Results':'نتائج الجولة',
  'Loading...':'جاري التحميل...','Disconnected!':'انقطع الاتصال!',
  'Reconnecting...':'جاري إعادة الاتصال...','Reconnected!':'تم الاتصال!',
  '🚀 Start New Game':'🚀 ابدأ لعبة جديدة','🔄 New Game':'🔄 لعبة جديدة',
  '🚀 Join Game':'🚀 انضم','Share 📤':'مشاركة 📤','Install App':'تثبيت التطبيق',
  'Open /host on TV to display the game!':'!افتح /host على التلفزيون لعرض اللعبة',
  'Correct!':'!صح','Wrong!':'!غلط', "Time's up!":'!انتهى الوقت',
  'Movies & TV Shows':'أفلام ومسلسلات','Arabic Movies & TV':'أفلام ومسلسلات عربية',
  'Flags & Countries':'أعلام ودول','Famous People':'مشاهير',
  'Football Clubs':'أندية كرة القدم','Sports Players':'لاعبين رياضيين',
  'Movie Posters':'ملصقات أفلام','TV Show Posters':'ملصقات مسلسلات',
  'Movie Scenes':'مشاهد أفلام','TV Show Scenes':'مشاهد مسلسلات',
  'Guess the Character':'خمّن الشخصية','Guess the Flag':'خمّن العلم',
  'Guess the Capital':'خمّن العاصمة','Guess the Continent':'خمّن القارة',
  'Guess the Map Shape':'خمّن شكل الخريطة','Guess the Landmark':'خمّن المعلم',
  'Guess the Famous Person':'خمّن الشخصية المشهورة',
  'Guess Their Nationality':'خمّن جنسيتهم',
  "Guess Why They're Famous":'خمّن سبب شهرتهم',
  'Guess Who Said It':'خمّن من قال هذا',
  'Guess the Connection':'خمّن الرابط',
  'What movie is this?':'ما هو هذا الفيلم؟',
  'What TV show is this?':'ما هو هذا المسلسل؟',
  'What movie is this scene from?':'من أي فيلم هذا المشهد؟',
  'What TV show is this scene from?':'من أي مسلسل هذا المشهد؟',
  'What country does this flag belong to?':'لأي دولة ينتمي هذا العلم؟',
  'Which country has this shape?':'أي دولة لها هذا الشكل؟',
  'What continent is this country in?':'في أي قارة تقع هذه الدولة؟',
  'Who is this famous person?':'من هذا الشخص المشهور؟',
  'What nationality is this person?':'ما جنسية هذا الشخص؟',
  'Who said this famous quote?':'من قال هذه المقولة المشهورة؟',
  'Who do these clues point to?':'على من تدل هذه التلميحات؟',
  'Scientist':'عالم','Athlete':'رياضي','Singer':'مغني','Composer':'مؤلف موسيقي',
  'Leader':'قائد','Author':'كاتب','Artist':'فنان','Director':'مخرج',
  'Inventor':'مخترع','Explorer':'مستكشف','Poet':'شاعر',
  'A famous quote':'مقولة مشهورة','Very well known':'معروفة جداً',
  'Think carefully':'فكّر جيداً','Famous Arabic quote':'مقولة عربية مشهورة',
  'Powered by Naseem Q. All rights reserved':'من تطوير نسيم ق. جميع الحقوق محفوظة',
  'How to Play':'كيف تلعب؟','How to Play & Install':'كيف تلعب؟',
  'GUESS THE CURRENCY':'خمّن العملة','GUESS THE FLAG':'خمّن العلم',
  'GUESS THE CAPITAL':'خمّن العاصمة','GUESS THE CONTINENT':'خمّن القارة',
  'GUESS THE MAP SHAPE':'خمّن شكل الخريطة','GUESS THE LANDMARK':'خمّن المعلم',
  'GUESS THE FAMOUS PERSON':'خمّن الشخصية المشهورة',
  'GUESS THEIR NATIONALITY':'خمّن جنسيتهم',
  "GUESS WHY THEY'RE FAMOUS":'خمّن سبب شهرتهم',
  'GUESS WHO SAID IT':'خمّن من قال هذا',
  'GUESS THE CONNECTION':'خمّن الرابط',
  'MOVIE POSTERS':'ملصقات أفلام','TV SHOW POSTERS':'ملصقات مسلسلات',
  'MOVIE SCENES':'مشاهد أفلام','TV SHOW SCENES':'مشاهد مسلسلات',
  'GUESS THE CHARACTER':'خمّن الشخصية',
};

function trPattern(text) {
  if (_lang !== 'ar' || !text) return text;
  var m;
  m = text.match(/^Question (\d+) of (\d+)$/);
  if (m) return 'سؤال ' + m[1] + ' من ' + m[2];
  m = text.match(/^Round (\d+)\/(\d+)$/);
  if (m) return 'الجولة ' + m[1] + '/' + m[2];
  m = text.match(/^ROUND (\d+) OF (\d+)$/);
  if (m) return 'الجولة ' + m[1] + ' من ' + m[2];
  m = text.match(/^(\d+) Questions$/);
  if (m) return m[1] + ' أسئلة';
  m = text.match(/^(\d+)\/(\d+) answered$/);
  if (m) return m[1] + '/' + m[2] + ' أجابوا';
  m = text.match(/^What is (.+) famous for\?$/);
  if (m) return 'بماذا اشتهر ' + m[1] + '؟';
  m = text.match(/^What is the capital of (.+)\?$/);
  if (m) return 'ما عاصمة ' + m[1] + '؟';
  m = text.match(/^Which famous landmark is in (.+)\?$/);
  if (m) return 'أي معلم مشهور في ' + m[1] + '؟';
  m = text.match(/^What character does this actor play in (.+)\?$/);
  if (m) return 'أي شخصية يلعبها هذا الممثل في ' + m[1] + '؟';
  m = text.match(/^R(\d+)\/(\d+) . Q(\d+)\/(\d+)$/);
  if (m) return 'ج' + m[1] + '/' + m[2] + ' · س' + m[3] + '/' + m[4];
  return text;
}

function tr(text) {
  if (!text || _lang !== 'ar') return text;
  if (T[text]) return T[text];
  var p = trPattern(text);
  if (p !== text) return p;
  var trimmed = text.trim();
  if (T[trimmed]) return T[trimmed];
  if (T[trimmed.toUpperCase()]) return T[trimmed.toUpperCase()];
  return text;
}

function getLang() { return _lang; }

var _translating = false;
function translateStatic() {
  if (_translating) return;
  _translating = true;
  try {
    var els = document.querySelectorAll('button, label, span, a, h1, h2, h3, p, div, td, th');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.id === 'lang-toggle') continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      
      // Get direct text content (skip elements with many children)
      var directText = '';
      for (var j = 0; j < el.childNodes.length; j++) {
        if (el.childNodes[j].nodeType === 3) directText += el.childNodes[j].textContent;
      }
      directText = directText.trim();
      if (!directText || directText.length > 200) continue;
      
      // Save original
      if (!el.getAttribute('data-ot')) el.setAttribute('data-ot', directText);
      var orig = el.getAttribute('data-ot');
      
      if (_lang === 'ar') {
        var translated = tr(orig);
        if (translated !== orig) {
          // Replace only the text node, keep child elements
          for (var j = 0; j < el.childNodes.length; j++) {
            if (el.childNodes[j].nodeType === 3 && el.childNodes[j].textContent.trim()) {
              el.childNodes[j].textContent = translated;
              break;
            }
          }
        }
      } else {
        for (var j = 0; j < el.childNodes.length; j++) {
          if (el.childNodes[j].nodeType === 3 && el.childNodes[j].textContent.trim()) {
            el.childNodes[j].textContent = orig;
            break;
          }
        }
      }
    }
    // Placeholders
    var inputs = document.querySelectorAll('input[placeholder]');
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i].getAttribute('data-oph')) inputs[i].setAttribute('data-oph', inputs[i].placeholder);
      var origPh = inputs[i].getAttribute('data-oph');
      inputs[i].placeholder = _lang === 'ar' ? tr(origPh) : origPh;
    }
  } finally {
    _translating = false;
  }
}

function setLang(newLang) {
  _lang = newLang;
  localStorage.setItem('game_lang', newLang);
  // NO dir change — keep LTR layout always
  if (newLang === 'ar') {
    document.body.style.fontFamily = "'Tajawal', 'Outfit', sans-serif";
  } else {
    document.body.style.fontFamily = "'Outfit', sans-serif";
  }
  var btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = newLang === 'ar' ? 'EN' : 'عربي';
  translateStatic();
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: newLang } }));
}

function initLang() {
  if (!document.getElementById('lang-toggle')) {
    var btn = document.createElement('button');
    btn.id = 'lang-toggle';
    btn.textContent = _lang === 'ar' ? 'EN' : 'عربي';
    btn.style.cssText = 'position:fixed;top:12px;left:12px;z-index:9999;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#FFE66D;font-size:14px;font-weight:700;padding:6px 14px;border-radius:20px;cursor:pointer;backdrop-filter:blur(8px);font-family:Tajawal,Outfit,sans-serif;transition:all 0.2s';
    btn.onmouseenter = function() { btn.style.background = 'rgba(255,230,109,0.2)'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(255,255,255,0.12)'; };
    btn.onclick = function() { setLang(_lang === 'ar' ? 'en' : 'ar'); };
    document.body.appendChild(btn);
  }
  setLang(_lang);
  // MutationObserver — translate new dynamic content as it appears
  var debounce = null;
  var observer = new MutationObserver(function() {
    if (_lang !== 'ar') return;
    clearTimeout(debounce);
    debounce = setTimeout(translateStatic, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLang);
} else {
  setTimeout(initLang, 100);
}

window.tr = tr;
window.getLang = getLang;
window.setLang = setLang;
