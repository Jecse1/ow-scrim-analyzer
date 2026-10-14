// 업로드 응답의 사전 검사 경고(warnings·warning_count)를 alert/confirm 용 한 줄로 만든다.
// 경고가 없으면 "" — 호출부는 그대로 문자열에 이어 붙이면 된다.
// 예: "\n경고 3건: bad_number×2, no_match_end×1"
export function precheckLine(data, t) {
  const n = Number(data?.warning_count) || 0;
  if (n <= 0) return "";
  const byCode = {};
  for (const w of data?.warnings || []) byCode[w.code] = (byCode[w.code] || 0) + 1;
  const codes = Object.entries(byCode).map(([c, k]) => `${c}×${k}`).join(", ");
  return `\n${t.pcWarnPrefix} ${n}${t.pcWarnUnit}${codes ? `: ${codes}` : ""}`;
}
