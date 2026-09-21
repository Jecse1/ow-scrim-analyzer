/**
 * 장면 −2초 리드는 파서(events.timestamp)에 이미 반영됨. 여기서 추가 보정 금지.
 *
 * YouTube 링크에 이벤트 시점 t= 파라미터를 추가해 반환.
 *
 * 신 방식 (game_setup_sec != null):
 *   video_offset = 영상에서 setup_complete 시점 (초)
 *   youtube_t = video_offset + (event.timestamp - game_setup_sec)
 *
 * 옛날 방식 (game_setup_sec == null, 기존 매치 호환):
 *   video_offset = 영상에서 match_start 시점 (초)
 *   youtube_t = video_offset + event.timestamp
 */
export function hasVideo(videoUrl) {
  return !!(videoUrl && videoUrl.trim() !== '');
}

export function buildVideoLink(videoUrl, eventTimestamp, match, pauseOverride, deltaSec = 0) {
  if (!videoUrl) return null;

  const videoOffset = Number(match?.video_offset) ?? 0;
  const gameSetupSec = match?.game_setup_sec;
  const pauses = pauseOverride ?? match?.pauses ?? [];
  // deltaSec = 라운드 전환 연출 동안 경기 타이머가 멈춰 생기는 영상 축 지연(라운드별 보정값).
  // pause와 같은 성질(영상에만 존재하는 시간)이므로 pause 포함 판정 전에 base에 더한다.
  const delta = Number(deltaSec) || 0;

  let targetVideoTime;
  if (gameSetupSec != null) {
    targetVideoTime = videoOffset + delta + (eventTimestamp - gameSetupSec);
  } else {
    targetVideoTime = videoOffset + delta + eventTimestamp;
  }

  if (pauses.length > 0) {
    const sorted = [...pauses].sort((a, b) => a.start_sec - b.start_sec);
    for (const p of sorted) {
      if (p.start_sec <= targetVideoTime) targetVideoTime += (p.end_sec - p.start_sec);
    }
  }

  const finalTime = Math.max(0, Math.floor(targetVideoTime));

  const cleanedUrl = videoUrl.replace(/[?&]t=[^&]*/g, '').replace(/[?&]$/, '');
  const separator = cleanedUrl.includes('?') ? '&' : '?';
  return `${cleanedUrl}${separator}t=${finalTime}`;
}
