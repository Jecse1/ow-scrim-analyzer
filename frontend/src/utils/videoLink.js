/**
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

export function buildVideoLink(videoUrl, eventTimestamp, match, pauseOverride) {
  if (!videoUrl) return null;

  const videoOffset = Number(match?.video_offset) ?? 0;
  const gameSetupSec = match?.game_setup_sec;
  const pauses = pauseOverride ?? match?.pauses ?? [];

  let targetVideoTime;
  if (gameSetupSec != null) {
    targetVideoTime = videoOffset + (eventTimestamp - gameSetupSec);
  } else {
    targetVideoTime = videoOffset + eventTimestamp;
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
