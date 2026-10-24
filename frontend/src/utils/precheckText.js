// 업로드 응답의 사전 검사 경고(warnings·warning_count)와 승자 미확정 사유(undetermined_reason)를
// alert/confirm 용 줄로 만든다. 둘 다 없으면 "" — 호출부는 그대로 문자열에 이어 붙이면 된다.
// 예: "\n경고 3건: bad_number×2, no_match_end×1\n승자 미확정(승패 보정 필요): 밀기 맵 — …"

// 판정 경로 코드(services/winner_source.WINNER_PATHS) → i18n 키. 코드 자체는 화면에 노출하지 않는다.
const UD_REASON_KEYS = {
  undetermined_push: "pcUdPush",
  undetermined_no_match_end: "pcUdNoMatchEnd",
  undetermined_progress_tie: "pcUdProgressTie",
  undetermined_score_tie: "pcUdScoreTie",
};

export function precheckLine(data, t) {
  let line = "";
  const n = Number(data?.warning_count) || 0;
  if (n > 0) {
    const byCode = {};
    for (const w of data?.warnings || []) byCode[w.code] = (byCode[w.code] || 0) + 1;
    const codes = Object.entries(byCode).map(([c, k]) => `${c}×${k}`).join(", ");
    line += `\n${t.pcWarnPrefix} ${n}${t.pcWarnUnit}${codes ? `: ${codes}` : ""}`;
  }
  const ud = data?.undetermined_reason;
  if (ud) line += `\n${t.pcUdPrefix}: ${t[UD_REASON_KEYS[ud]] || t.pcUdOther}`;
  return line;
}
