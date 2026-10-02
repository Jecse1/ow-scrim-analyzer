// useCanvasDoc.js — 캔버스 문서 모델: 로드/직렬화(version:1) · 언두 10단계 · 1.5초 디바운스 자동저장 ·
// 저장 실패 localStorage 임시본 · 서버 갱신 감지(S2는 배너에서 사용). ReactFlow state 를 감싼다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNodesState, useEdgesState } from "@xyflow/react";
import { plansApi, parseServerTime } from "../api";

const VERSION = 1;
const HISTORY_MAX = 10;
const SAVE_DEBOUNCE = 1500;
const LS_KEY = (id) => `plans.canvas.backup.${id}`;

const serialize = (nodes, edges) => JSON.stringify({ version: VERSION, nodes, edges });

export function useCanvasDoc(planMapId) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle|saving|saved|error
  const [savedAt, setSavedAt] = useState(null);
  const [serverUpdatedAt, setServerUpdatedAt] = useState(null);
  const [hasBackup, setHasBackup] = useState(false);

  const lastSavedRef = useRef("");       // 마지막으로 서버에 저장된 직렬화 문자열
  const loadedRef = useRef(false);
  const timerRef = useRef(null);
  const histRef = useRef({ past: [], future: [] });
  const applyingRef = useRef(false);     // 언두/리두 적용 중 — 히스토리 재기록 방지
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  const [, force] = useState(0);

  // ── 로드 ──
  useEffect(() => {
    let alive = true;
    setLoaded(false); loadedRef.current = false;
    histRef.current = { past: [], future: [] };
    plansApi.getCanvas(planMapId).then((res) => {
      if (!alive) return;
      const c = res.canvas || {};
      setNodes(c.nodes || []);
      setEdges(c.edges || []);
      setServerUpdatedAt(res.updated_at || null);
      lastSavedRef.current = serialize(c.nodes || [], c.edges || []);
      setSaveStatus("saved"); setSavedAt(Date.now());
      try { setHasBackup(!!localStorage.getItem(LS_KEY(planMapId))); } catch { /* ignore */ }
      setLoaded(true);
      requestAnimationFrame(() => { loadedRef.current = true; });
    }).catch(() => { if (alive) { setSaveStatus("error"); setLoaded(true); } });
    return () => { alive = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [planMapId]); // eslint-disable-line

  // ── 저장 ──
  const doSave = useCallback(async () => {
    const payload = serialize(nodesRef.current, edgesRef.current);
    if (payload === lastSavedRef.current) { setSaveStatus("saved"); return; }
    setSaveStatus("saving");
    try {
      const res = await plansApi.putCanvas(planMapId, { version: VERSION, nodes: nodesRef.current, edges: edgesRef.current });
      lastSavedRef.current = payload;
      setServerUpdatedAt(res.updated_at || null);
      setSaveStatus("saved"); setSavedAt(Date.now());
      try { localStorage.removeItem(LS_KEY(planMapId)); } catch { /* ignore */ }
      setHasBackup(false);
    } catch {
      setSaveStatus("error");
      try { localStorage.setItem(LS_KEY(planMapId), payload); setHasBackup(true); } catch { /* ignore */ }
    }
  }, [planMapId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doSave, SAVE_DEBOUNCE);
  }, [doSave]);

  // 변경 감지 → 디바운스 저장
  useEffect(() => {
    if (!loadedRef.current) return;
    if (serialize(nodes, edges) === lastSavedRef.current) return;
    scheduleSave();
  }, [nodes, edges, scheduleSave]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (loadedRef.current && serialize(nodesRef.current, edgesRef.current) !== lastSavedRef.current) return doSave();
  }, [doSave]);

  const retrySave = useCallback(() => doSave(), [doSave]);

  // ── 히스토리(언두 10단계) ──
  const pushHistory = useCallback(() => {
    if (applyingRef.current) return;
    const snap = { nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) };
    const h = histRef.current;
    h.past.push(snap);
    if (h.past.length > HISTORY_MAX) h.past.shift();
    h.future = [];
    force((x) => x + 1);
  }, []);

  const applySnap = (snap) => {
    applyingRef.current = true;
    setNodes(snap.nodes); setEdges(snap.edges);
    requestAnimationFrame(() => { applyingRef.current = false; });
  };
  const undo = useCallback(() => {
    const h = histRef.current;
    if (!h.past.length) return;
    h.future.push({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
    applySnap(h.past.pop());
    force((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    const h = histRef.current;
    if (!h.future.length) return;
    h.past.push({ nodes: JSON.parse(JSON.stringify(nodesRef.current)), edges: JSON.parse(JSON.stringify(edgesRef.current)) });
    applySnap(h.future.pop());
    force((x) => x + 1);
  }, []);
  const canUndo = histRef.current.past.length > 0;
  const canRedo = histRef.current.future.length > 0;

  // ── localStorage 임시본 복구(S1) ──
  const applyBackup = useCallback(() => {
    try {
      const raw = localStorage.getItem(LS_KEY(planMapId));
      if (!raw) return;
      const doc = JSON.parse(raw);
      pushHistory();
      setNodes(doc.nodes || []); setEdges(doc.edges || []);
      setHasBackup(false);
    } catch { /* ignore */ }
  }, [planMapId, pushHistory]);
  const discardBackup = useCallback(() => {
    try { localStorage.removeItem(LS_KEY(planMapId)); } catch { /* ignore */ }
    setHasBackup(false);
  }, [planMapId]);

  return {
    nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange,
    loaded, saveStatus, savedAt, serverUpdatedAt,
    pushHistory, undo, redo, canUndo, canRedo,
    flush, retrySave,
    hasBackup, applyBackup, discardBackup,
    nodesRef, edgesRef,
  };
}

export { VERSION as CANVAS_VERSION };
