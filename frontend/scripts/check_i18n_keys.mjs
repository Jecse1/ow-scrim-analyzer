// i18n 키 검사: ko·en·zh 키 집합이 같고, 허용 목록 밖에 빈 문자열이 없어야 한다.
// 실행: node scripts/check_i18n_keys.mjs (CI frontend job 에서 build 전에 실행)
import ko from '../src/i18n/ko.js';
import en from '../src/i18n/en.js';
import zh from '../src/i18n/zh.js';

// 의도된 빈 단위어(접두/접미사가 그 언어에 없음). 화면 불변 — 값을 채우면 표시가 바뀐다.
const ALLOWED_EMPTY = {
  ko: ['smMatchPre', 'osNoMatchDataPre'],
  en: ['timesUnit', 'msCountUnit', 'pcWarnUnit', 'osNoMatchDataPost', 'osTotalWord'],
  zh: [],
};

const langs = { ko, en, zh };
const names = Object.keys(langs);
const union = new Set(names.flatMap((l) => Object.keys(langs[l])));
const errors = [];

for (const l of names) {
  const keys = new Set(Object.keys(langs[l]));
  for (const k of union) if (!keys.has(k)) errors.push(`${l}: missing key "${k}"`);
  for (const [k, v] of Object.entries(langs[l])) {
    if (typeof v !== 'string') errors.push(`${l}.${k}: not a string`);
    else if (v === '' && !ALLOWED_EMPTY[l].includes(k)) errors.push(`${l}.${k}: empty string`);
  }
  for (const k of ALLOWED_EMPTY[l]) if (langs[l][k] !== '') errors.push(`${l}.${k}: listed as allowed-empty but is not empty`);
}

if (errors.length) {
  console.error(`[i18n] ${errors.length} problem(s):\n` + errors.map((e) => '  ' + e).join('\n'));
  process.exit(1);
}
console.log(`[i18n] ok: ${names.length} languages x ${union.size} keys`);
