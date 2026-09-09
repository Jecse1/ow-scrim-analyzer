// check_image_fields.mjs — 상시 검사(STEP 3 도입).
// heroes.json 의 각 영웅 image 필드가 public/heroes/ 에 "바이트 단위(대소문자 포함)"로
// 정확히 존재하는 파일을 가리키는지 검증한다.
//   · Windows 개발서버는 대소문자를 무시하므로 image='sierra'가 Sierra.png로도 200을 내지만,
//     리눅스 nginx(대소문자 구분)에서는 404가 된다. 이 유형은 자동 검사 없이는 재발한다.
//   · 불일치가 1건이라도 있으면 exit 1 (CI/커밋 훅에서 차단 가능).
// 사용: node frontend/scripts/check_image_fields.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const HEROES_JSON = path.join(ROOT, 'backend', 'game_data', 'heroes.json');
const HEROES_DIR = path.join(ROOT, 'frontend', 'public', 'heroes');

const heroes = JSON.parse(fs.readFileSync(HEROES_JSON, 'utf8')).heroes;
const filesExact = new Set(fs.readdirSync(HEROES_DIR));
const filesLower = new Set([...filesExact].map((f) => f.toLowerCase()));

const missing = [];      // 대소문자 무시해도 없음(진짜 누락)
const caseMismatch = []; // 소문자로는 있으나 정확한 대소문자로는 없음(리눅스 404 위험)
for (const h of heroes) {
  const fname = `${h.image}.png`;
  if (filesExact.has(fname)) continue;
  if (filesLower.has(fname.toLowerCase())) caseMismatch.push({ id: h.id, image: h.image, expected: fname });
  else missing.push({ id: h.id, image: h.image, expected: fname });
}

const total = heroes.length;
console.log(`[check_image_fields] heroes=${total}  ok=${total - missing.length - caseMismatch.length}  caseMismatch=${caseMismatch.length}  missing=${missing.length}`);
for (const m of caseMismatch) console.log(`  CASE-MISMATCH ${m.id}: image="${m.image}" → ${m.expected} 없음(대소문자). 실제 파일명과 image 값을 일치시켜라.`);
for (const m of missing) console.log(`  MISSING       ${m.id}: image="${m.image}" → ${m.expected} 파일 없음.`);

if (missing.length || caseMismatch.length) process.exit(1);
console.log('[check_image_fields] OK — 전 영웅 image 필드가 실제 파일과 대소문자까지 일치.');
