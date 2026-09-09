// 밴픽 실시간 대결 — WebSocket 클라이언트(서버 권위).
// 클라는 액션 전송 + 서버 state 수신/렌더만. 서버가 유일 진실 원본.
// dev는 vite 프록시(/ws), prod는 동일 오리진(/ws)로 연결.
import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = () => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/banpick`;
};

const SS_KEY = "banpick_session"; // sessionStorage: {code, role, token}

type Session = { code: string; role: "A" | "B"; token: string } | null;

function loadSession(): Session {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session) {
  try {
    if (s) sessionStorage.setItem(SS_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SS_KEY);
  } catch {
    /* noop */
  }
}

export function useBanpickWS(active: boolean) {
  const [remote, setRemote] = useState<any>(null);   // 서버 권위 state
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState<string>("");
  const [myRole, setMyRole] = useState<"A" | "B" | null>(null);
  const [opponentConnected, setOpponentConnected] = useState<boolean>(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<Session>(null);
  const wantReconnectRef = useRef(false);

  const rawSend = useCallback((msg: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // 게임 액션 전송 (map_pick/ban/pick_toggle/pick_lock/set_result/ready/start ...)
  const send = useCallback((msg: any) => rawSend(msg), [rawSend]);

  const open = useCallback((onOpen?: () => void) => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      onOpen?.();
      return;
    }
    const ws = new WebSocket(WS_URL());
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      onOpen?.();
    };
    ws.onclose = () => {
      setConnected(false);
      // 순단 시 자동 재접속(세션 있으면 reconnect)
      if (wantReconnectRef.current && sessionRef.current) {
        setTimeout(() => open(() => rawSend({ type: "reconnect", code: sessionRef.current!.code, token: sessionRef.current!.token })), 1000);
      }
    };
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case "room_created":
        case "joined":
        case "reconnected": {
          const sess: Session = { code: m.code ?? sessionRef.current?.code ?? roomCode, role: m.role, token: m.token ?? sessionRef.current?.token ?? "" };
          sessionRef.current = sess;
          saveSession(sess);
          setRoomCode(sess.code);
          setMyRole(m.role);
          if (m.state) setRemote(m.state);
          setError(null);
          break;
        }
        case "state":
          setRemote(m.state);
          break;
        case "timer":
          setRemote((prev: any) => (prev ? { ...prev, timer: m.timer, timerRunning: m.timerRunning, overtime: m.overtime } : prev));
          break;
        case "opponent_status":
          setOpponentConnected(!!m.connected);
          break;
        case "error":
          setError({ code: m.code, message: m.message });
          break;
      }
    };
  }, [rawSend, roomCode]);

  const createRoom = useCallback((config: any) => {
    wantReconnectRef.current = true;
    open(() => rawSend({ type: "create_room", config }));
  }, [open, rawSend]);

  const joinRoom = useCallback((code: string) => {
    wantReconnectRef.current = true;
    open(() => rawSend({ type: "join_room", code }));
  }, [open, rawSend]);

  const leave = useCallback(() => {
    wantReconnectRef.current = false;
    saveSession(null);
    sessionRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setRemote(null); setRoomCode(""); setMyRole(null); setConnected(false);
  }, []);

  // 활성화 시, 기존 세션 있으면 자동 재접속 시도(새로고침 복구)
  useEffect(() => {
    if (!active) return;
    const s = loadSession();
    if (s) {
      sessionRef.current = s;
      setRoomCode(s.code);
      setMyRole(s.role);
      wantReconnectRef.current = true;
      open(() => rawSend({ type: "reconnect", code: s.code, token: s.token }));
    }
    return () => {
      wantReconnectRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return {
    remote, connected, roomCode, myRole, opponentConnected, error,
    createRoom, joinRoom, leave, send, clearError: () => setError(null),
  };
}
