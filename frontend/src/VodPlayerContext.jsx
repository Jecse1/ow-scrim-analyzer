// VOD 앱 내 플레이어(embed) — watch&t= 새 탭이 계정 시청 기록 이어보기에 덮이는 문제 대응 시험.
// openVod(url, label): 설정 vodMode('player'|'tab', localStorage)에 따라
//   'player' → embed iframe 모달(정확한 t에서 시작), 'tab' → 기존 새 탭.
// t 계산(buildVideoLink·라운드 보정·pause)은 호출처에서 끝난 최종 watch URL을 그대로 받아 분해만 한다.
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { X, ExternalLink } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";

const VodContext = createContext(null);

export const getVodMode = () => {
  try { return localStorage.getItem("vodMode") === "tab" ? "tab" : "player"; }
  catch { return "player"; }
};

// watch?v= / youtu.be/ / /live/ 세 형식에서 videoId, t= 파라미터 추출. 실패 시 null.
export function parseVodUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let id = null;
    if (u.searchParams.get("v")) id = u.searchParams.get("v");
    else if (u.hostname.endsWith("youtu.be")) id = u.pathname.split("/").filter(Boolean)[0] || null;
    else {
      const mLive = u.pathname.match(/\/live\/([\w-]+)/);
      if (mLive) id = mLive[1];
    }
    if (!id) return null;
    const t = parseInt(String(u.searchParams.get("t") || "0").replace(/s$/, ""), 10) || 0;
    return { videoId: id, t };
  } catch { return null; }
}

export function VodProvider({ children }) {
  const [vodMode, setVodModeState] = useState(getVodMode);
  const [modal, setModal] = useState(null); // {videoId, t, url, label} | null

  const setVodMode = (mode) => {
    setVodModeState(mode);
    try { localStorage.setItem("vodMode", mode); } catch { /* ignore */ }
  };

  const openVod = useCallback((url, label = "") => {
    if (!url) return;
    const parsed = getVodMode() === "player" ? parseVodUrl(url) : null;
    if (parsed) setModal({ ...parsed, url, label });
    else window.open(url, "_blank", "noopener,noreferrer"); // 'tab' 모드 or 파싱 실패 폴백
  }, []);

  return (
    <VodContext.Provider value={{ openVod, vodMode, setVodMode }}>
      {children}
      {modal && <VodPlayerModal {...modal} onClose={() => setModal(null)} />}
    </VodContext.Provider>
  );
}

export function useVod() {
  // Provider 밖(예: 테스트)에서도 새 탭 폴백으로 동작하도록 기본값 제공
  return useContext(VodContext) || {
    openVod: (url) => url && window.open(url, "_blank", "noopener,noreferrer"),
    vodMode: "tab", setVodMode: () => {},
  };
}

// <a href={watchUrl} {...vodClickProps(openVod, watchUrl, label)}> — href는 유지(우클릭 복사·중클릭 새 탭),
// 수식키 없는 좌클릭만 가로채 모달/새 탭 분기.
export const vodClickProps = (openVod, url, label = "") => ({
  onClick: (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openVod(url, label);
  },
});

function VodPlayerModal({ videoId, t, url, label, onClose }) {
  const { theme } = useTheme();
  const { t: tr } = useLanguage();
  const [blocked, setBlocked] = useState(false); // 퍼가기 금지(embed error 101/150/153)

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 퍼가기 금지 감지: enablejsapi=1 + postMessage 구독 → onError(101/150/153) 수신 시 안내로 전환
  useEffect(() => {
    const onMsg = (e) => {
      if (typeof e.origin !== "string" || !e.origin.includes("youtube.com")) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d && d.event === "onError" && [101, 150, 153].includes(Number(d.info))) setBlocked(true);
      } catch { /* ignore */ }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const subscribe = (e) => {
    // IFrame API 이벤트 구독(위 onError 수신용)
    try { e.target.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "vod", channel: "widget" }), "*"); }
    catch { /* ignore */ }
  };

  const src = `https://www.youtube.com/embed/${videoId}?start=${Math.max(0, Math.floor(t))}&autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "90%", maxWidth: 1280, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label || tr.vodPlayerTitle}
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: theme.text, background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, borderRadius: 8, padding: "6px 10px", textDecoration: "none" }}>
            <ExternalLink size={13} /> {tr.vodOpenYoutube}
          </a>
          <button onClick={onClose} aria-label="close"
            style={{ background: "transparent", border: "none", color: theme.textSub, cursor: "pointer", padding: 4, display: "inline-flex" }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
          {blocked ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "#fff", padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{tr.vodEmbedBlocked}</div>
              <a href={url} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: "#000", background: "#fff", borderRadius: 10, padding: "10px 16px", textDecoration: "none" }}>
                <ExternalLink size={15} /> {tr.vodOpenYoutube}
              </a>
            </div>
          ) : (
            <iframe
              title="VOD"
              src={src}
              onLoad={subscribe}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}
        </div>
      </div>
    </div>
  );
}
