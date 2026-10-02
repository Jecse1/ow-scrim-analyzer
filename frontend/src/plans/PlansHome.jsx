// PlansHome.jsx — 드래프트 플랜 홈. 좌: 보드 목록(인라인 편집·드래그 정렬·추가·삭제확인),
// 우: 선택 보드의 맵 카드 그리드(노드수·수정시각·호버 액션·드래그 정렬). 맵 추가 모달.
// 선택 보드·스크롤 위치는 sessionStorage 보존. 모바일(≤767): 보드 드롭다운 + 1열 + ⋯ 메뉴.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, GripVertical, Trash2, Copy, FolderInput, ExternalLink, MoreVertical, X,
} from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { useTheme } from "../ThemeContext";
import { getMapDisplayName, BANPICK_MAPS } from "../gameData";
import { MapThumb, MapTypeBadge } from "../shared/heroMapAssets";
import { plansApi, formatRelative } from "./api";
import { planT } from "./i18n";
import AddMapModal from "./AddMapModal";
import "./plans.css";

const SS_BOARD = "plans.selectedBoard";
const SS_SCROLL = "plans.scrollTop";
const mapType = (mapId) => (BANPICK_MAPS.find((m) => m.id === mapId) || {}).type || "Control";

export default function PlansHome({ onOpenMap }) {
  const { language } = useLanguage();
  const { isDarkMode: dark } = useTheme();
  const t = planT(language);

  const [boards, setBoards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(() => sessionStorage.getItem(SS_BOARD) || null);
  const [editingBoard, setEditingBoard] = useState(null); // board id
  const [editName, setEditName] = useState("");
  const [confirmBoard, setConfirmBoard] = useState(null); // board obj
  const [showAdd, setShowAdd] = useState(false);
  const [moveMenu, setMoveMenu] = useState(null); // plan_map id
  const [kebab, setKebab] = useState(null); // plan_map id (mobile)
  const [toast, setToast] = useState(null);

  const dragBoard = useRef(null);
  const dragMap = useRef(null);
  const gridRef = useRef(null);
  const toastSeq = useRef(0);

  // API 실패 시 토스트(무반응 방지). axios 에러면 상태코드, 백엔드 미실행이면 네트워크 메시지.
  const popToast = (msg) => { const id = ++toastSeq.current; setToast(msg); setTimeout(() => { if (toastSeq.current === id) setToast(null); }, 4000); };
  const errCode = (e) => (e?.response?.status ? String(e.response.status) : (e?.code || t.networkErr || "연결 실패"));
  const guard = (label, fn) => async (...a) => { try { return await fn(...a); } catch (e) { popToast(`${label}: ${errCode(e)}`); } };

  const refresh = async () => {
    const data = await plansApi.listBoards();
    setBoards(data);
    setLoaded(true);
    return data;
  };
  useEffect(() => { refresh().catch(() => setLoaded(true)); }, []);

  // 선택 보드 결정(저장값 → 없으면 첫 보드) + sessionStorage 반영
  const selectedBoard = useMemo(() => {
    if (!boards.length) return null;
    return boards.find((b) => b.id === selectedId) || boards[0];
  }, [boards, selectedId]);
  useEffect(() => { if (selectedBoard) sessionStorage.setItem(SS_BOARD, selectedBoard.id); }, [selectedBoard]);

  // 스크롤 위치 복원/저장
  useEffect(() => {
    const el = gridRef.current; if (!el) return;
    const saved = Number(sessionStorage.getItem(SS_SCROLL) || 0);
    if (saved) el.scrollTop = saved;
    const onScroll = () => sessionStorage.setItem(SS_SCROLL, String(el.scrollTop));
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [selectedBoard, loaded]);

  // ── 보드 액션 (모두 guard 로 감싸 실패 시 토스트) ──
  const addBoard = guard(t.createBoardFailed, async () => {
    const b = await plansApi.createBoard(t.newBoard);
    await refresh();
    setSelectedId(b.id);
    setEditingBoard(b.id); setEditName(b.name);
  });
  const commitRename = guard(t.updateFailed, async (id) => {
    const name = editName.trim();
    setEditingBoard(null);
    if (name && boards.find((b) => b.id === id)?.name !== name) {
      await plansApi.updateBoard(id, { name });
      await refresh();
    }
  });
  const doDeleteBoard = guard(t.deleteFailed, async (id) => {
    setConfirmBoard(null);
    await plansApi.deleteBoard(id);
    const data = await refresh();
    if (selectedId === id) setSelectedId(data[0]?.id || null);
  });
  const reorderBoards = guard(t.orderFailed, async (from, to) => {
    if (from === to) return;
    const arr = [...boards];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setBoards(arr.map((b, i) => ({ ...b, sort_order: i + 1 }))); // 낙관적
    await Promise.all(arr.map((b, i) => (b.sort_order !== i + 1 ? plansApi.updateBoard(b.id, { sort_order: i + 1 }) : null)).filter(Boolean));
    await refresh();
  });

  // ── 맵 액션 (실패 시 토스트) ──
  const addMap = guard(t.addMapFailed, async (mapId) => { await plansApi.createMap(selectedBoard.id, mapId); await refresh(); });
  const dupMap = guard(t.dupFailed, async (id) => { await plansApi.duplicateMap(id); await refresh(); });
  const moveMap = guard(t.moveFailed, async (id, toBoard) => { setMoveMenu(null); setKebab(null); await plansApi.updateMap(id, { board_id: toBoard }); await refresh(); });
  const delMap = guard(t.deleteFailed, async (id) => { setKebab(null); await plansApi.deleteMap(id); await refresh(); });
  const reorderMaps = guard(t.orderFailed, async (from, to) => {
    if (from === to || !selectedBoard) return;
    const maps = [...selectedBoard.maps];
    const [moved] = maps.splice(from, 1);
    maps.splice(to, 0, moved);
    setBoards((bs) => bs.map((b) => b.id === selectedBoard.id ? { ...b, maps: maps.map((m, i) => ({ ...m, sort_order: i + 1 })) } : b));
    await Promise.all(maps.map((m, i) => (m.sort_order !== i + 1 ? plansApi.updateMap(m.id, { sort_order: i + 1 }) : null)).filter(Boolean));
    await refresh();
  });

  const maps = selectedBoard?.maps || [];
  const existingIds = useMemo(() => new Set(maps.map((m) => m.map_id)), [maps]);

  // ── 렌더: 보드 한 행 ──
  const BoardRow = ({ b, i }) => (
    <div
      className={"plan-board-row" + (selectedBoard?.id === b.id ? " active" : "")}
      draggable={editingBoard !== b.id}
      onDragStart={() => { dragBoard.current = i; }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={() => { if (dragBoard.current != null) reorderBoards(dragBoard.current, i); dragBoard.current = null; }}
      onClick={() => setSelectedId(b.id)}
    >
      <span className="plan-board-handle"><GripVertical size={14} /></span>
      {editingBoard === b.id ? (
        <input
          className="plan-board-name-input" value={editName} autoFocus
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitRename(b.id); if (e.key === "Escape") setEditingBoard(null); }}
          onBlur={() => commitRename(b.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="plan-board-name" onDoubleClick={(e) => { e.stopPropagation(); setEditingBoard(b.id); setEditName(b.name); }}>{b.name}</span>
      )}
      <span className="plan-board-count">{(b.maps || []).length}</span>
      <button className="plan-board-del" onClick={(e) => { e.stopPropagation(); setConfirmBoard(b); }} aria-label={t.del}><Trash2 size={14} /></button>
    </div>
  );

  // ── 렌더: 맵 카드 ──
  const MapCard = ({ m, i }) => {
    const otherBoards = boards.filter((b) => b.id !== selectedBoard.id);
    return (
      <div
        className="plan-card"
        draggable
        onDragStart={() => { dragMap.current = i; }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => { if (dragMap.current != null) reorderMaps(dragMap.current, i); dragMap.current = null; }}
        onClick={() => onOpenMap(m.id)}
      >
        <div className="plan-card-thumb"><MapThumb id={m.map_id} /></div>
        <span className="plan-card-badge">{t.nodesUnit(m.node_count || 0)}</span>

        <button className="plan-card-kebab" onClick={(e) => { e.stopPropagation(); setKebab(kebab === m.id ? null : m.id); }} aria-label="메뉴"><MoreVertical size={16} /></button>

        <div className="plan-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="plan-act-btn" title={t.open} onClick={() => onOpenMap(m.id)}><ExternalLink size={15} /></button>
          <button className="plan-act-btn" title={t.duplicate} onClick={() => dupMap(m.id)}><Copy size={15} /></button>
          <button className="plan-act-btn" title={t.moveTo} onClick={() => setMoveMenu(moveMenu === m.id ? null : m.id)} disabled={otherBoards.length === 0}><FolderInput size={15} /></button>
          <button className="plan-act-btn danger" title={t.del} onClick={() => delMap(m.id)}><Trash2 size={15} /></button>
        </div>

        {(moveMenu === m.id || kebab === m.id) && (
          <div className="plan-move-menu" onClick={(e) => e.stopPropagation()}>
            {kebab === m.id && (
              <>
                <button className="plan-move-item" onClick={() => { setKebab(null); onOpenMap(m.id); }}>{t.open}</button>
                <button className="plan-move-item" onClick={() => { setKebab(null); dupMap(m.id); }}>{t.duplicate}</button>
                <button className="plan-move-item" onClick={() => delMap(m.id)}>{t.del}</button>
              </>
            )}
            <div className="plan-move-head">{t.moveTo}</div>
            {otherBoards.length === 0 && <div className="plan-move-item" style={{ opacity: .5 }}>—</div>}
            {otherBoards.map((b) => (
              <button key={b.id} className="plan-move-item" onClick={() => moveMap(m.id, b.id)}>{b.name}</button>
            ))}
          </div>
        )}

        <div className="plan-card-meta">
          <div className="plan-card-name">
            <MapTypeBadge type={mapType(m.map_id)} lang={language} className="shrink-0" />
            <span>{getMapDisplayName(m.map_id, language)}</span>
          </div>
          <div className="plan-card-time">{formatRelative(m.updated_at, language)}</div>
        </div>
      </div>
    );
  };

  return (
    <div className={"plan-root " + (dark ? "" : "light")} onClick={() => { setMoveMenu(null); setKebab(null); }}>
      <div className="plan-home">
        {/* ── 사이드바(데스크톱) ── */}
        <div className="plan-sidebar">
          <div className="plan-sidebar-title">{t.boards}</div>
          {/* 모바일 드롭다운 */}
          {boards.length > 0 && (
            <div className="plan-board-select plan-mobile-only">
              <select value={selectedBoard?.id || ""} onChange={(e) => setSelectedId(e.target.value)}>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name} ({(b.maps || []).length})</option>)}
              </select>
              <button className="plan-act-btn danger" style={{ width: 38, height: 38, borderRadius: 9 }} aria-label={t.del} onClick={() => selectedBoard && setConfirmBoard(selectedBoard)}><Trash2 size={16} /></button>
            </div>
          )}
          <div className="plan-desktop-only">
            {boards.map((b, i) => <BoardRow key={b.id} b={b} i={i} />)}
          </div>
          <button className="plan-addboard" onClick={addBoard}><Plus size={15} />{t.addBoard}</button>
        </div>

        {/* ── 메인 ── */}
        <div className="plan-main">
          {!loaded ? null : !boards.length ? (
            <div className="plan-empty plan-empty-card" onClick={addBoard}>
              <div className="plan-empty-strong">{t.noBoards}</div>
              <div>{t.firstBoard}</div>
            </div>
          ) : (
            <>
              <div className="plan-main-head">
                <div className="plan-main-title">{selectedBoard?.name}</div>
                <button className="plan-add-map" onClick={() => setShowAdd(true)}><Plus size={15} />{t.addMap}</button>
              </div>
              {maps.length === 0 ? (
                <div className="plan-empty">
                  <div className="plan-empty-strong">{t.noMaps}</div>
                  <div>{t.addMapHint}</div>
                </div>
              ) : (
                <div className="plan-map-grid" ref={gridRef}>
                  {maps.map((m, i) => <MapCard key={m.id} m={m} i={i} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 맵 추가 모달 */}
      {showAdd && selectedBoard && (
        <AddMapModal lang={language} existingMapIds={existingIds} onAdd={addMap} onClose={() => setShowAdd(false)} />
      )}

      {/* 보드 삭제 확인 */}
      {confirmBoard && (
        <div className="plan-modal-backdrop" onClick={() => setConfirmBoard(null)}>
          <div className="plan-modal sm" onClick={(e) => e.stopPropagation()}>
            <div className="plan-modal-head">{t.confirmDelBoardTitle}
              <button className="plan-modal-close" onClick={() => setConfirmBoard(null)}><X size={18} /></button>
            </div>
            <div className="plan-modal-body">{t.confirmDelBoard(confirmBoard.name, (confirmBoard.maps || []).length)}</div>
            <div className="plan-modal-foot">
              <button className="plan-btn" onClick={() => setConfirmBoard(null)}>{t.cancel}</button>
              <button className="plan-btn danger" onClick={() => doDeleteBoard(confirmBoard.id)}>{t.del}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="plan-toast" role="status">{toast}</div>}
    </div>
  );
}
