// PlanCanvas.jsx — ReactFlow 래퍼. 노드 4종+그룹, 엣지, 조작(더블클릭 추가·핸들 연결·선택/다중/그룹·
// 복제·언두/리두·화살표 이동·스냅·팬/줌), 자동저장, HeroPicker·조건편집·노드종류 팝업. 미니맵/템플릿/PNG=②.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType,
  addEdge, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { useLanguage } from "../../LanguageContext";
import { planT } from "../i18n";
import { useCanvasDoc } from "./useCanvasDoc";
import { CanvasCtx } from "./nodes/ctx";
import Toolbar from "./Toolbar";
import TopBar from "./TopBar";
import HeroPicker, { pushRecent } from "./HeroPicker";
import ConditionNode from "./nodes/ConditionNode";
import HeroNode from "./nodes/HeroNode";
import CompNode from "./nodes/CompNode";
import TextNode from "./nodes/TextNode";
import GroupNode from "./nodes/GroupNode";
import LabeledEdge from "./edges/LabeledEdge";
import { COND_ORDER, COND_TYPES, NODE_KINDS, SLOT_ROLES } from "./constants";
import { applyTemplate, TEMPLATE_KINDS } from "./templates";
import { exportCanvasPng, pngFilename } from "./pngExport";
import { formatRelative } from "../api";

const nodeTypes = { condition: ConditionNode, hero: HeroNode, comp: CompNode, text: TextNode, group: GroupNode };
const edgeTypes = { labeled: LabeledEdge };
const EDGE_OPTS = { type: "labeled", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#71717a" } };
const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : "n_" + Date.now() + "_" + Math.floor(Math.random() * 1e6));

const defaultData = (type) => ({
  condition: { condType: "enemy_ban" },
  hero: { heroId: null },
  comp: { slots: [null, null, null, null, null] },
  text: { title: "", body: "" },
  group: { label: "" },
}[type] || {});

function Flow({ planMapId, boardName, mapRow, onBack, strip, extras }) {
  const { language } = useLanguage();
  const t = planT(language);
  const doc = useCanvasDoc(planMapId);
  const { nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, pushHistory, undo, redo, canUndo, canRedo } = doc;
  const rf = useReactFlow();
  const [tool, setTool] = useState("select");
  const [snap, setSnap] = useState(false);
  const [kindPopup, setKindPopup] = useState(null); // {x,y,flow,connect?}
  const [picker, setPicker] = useState(null);        // {nodeId, slotIndex?, role?}
  const [condEdit, setCondEdit] = useState(null);    // {nodeId}
  const [tplOpen, setTplOpen] = useState(false);     // 템플릿 선택(S4)
  const [exportOpen, setExportOpen] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [mobile, setMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));
  const [mobileDetail, setMobileDetail] = useState(null); // 모바일 노드 탭 내용
  const wrapRef = useRef(null);
  const arrowTs = useRef(0);

  useEffect(() => { const h = () => setMobile(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);

  // 이탈 시 flush (S3)
  useEffect(() => () => { doc.flush(); }, []); // eslint-disable-line

  // 새 맵(노드 0) 첫 진입 → 템플릿 선택(S4). 맵별 1회(localStorage).
  const tplKey = `plans.canvas.tpl.${planMapId}`;
  useEffect(() => {
    if (!doc.loaded) return;
    let chosen = false; try { chosen = !!localStorage.getItem(tplKey); } catch { /* ignore */ }
    if (doc.nodes.length === 0 && !chosen) setTplOpen(true);
  }, [doc.loaded]); // eslint-disable-line
  const chooseTemplate = (type) => {
    try { localStorage.setItem(tplKey, type); } catch { /* ignore */ }
    setTplOpen(false);
    if (type === "ban") { pushHistory(); const { nodes: tn, edges: te } = applyTemplate("ban", language); setNodes(tn); setEdges(te); }
  };

  const onExport = async () => {
    setExportOpen(false);
    await exportCanvasPng({ nodes: doc.nodesRef.current, filename: pngFilename(boardName, mapRow ? mapRow.map_id : "map"), transparent });
  };

  // ── 노드 데이터/엣지 수정 ──
  const updateNodeData = useCallback((id, patch, record = false) => {
    if (record) pushHistory();
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [pushHistory, setNodes]);
  const updateEdgeData = useCallback((id, patch) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)));
  }, [setEdges]);

  const duplicateNode = useCallback((id) => {
    pushHistory();
    setNodes((ns) => {
      const src = ns.find((n) => n.id === id); if (!src) return ns;
      const copy = { ...src, id: newId(), position: { x: src.position.x + 28, y: src.position.y + 28 }, data: JSON.parse(JSON.stringify(src.data || {})), selected: false };
      return ns.concat(copy);
    });
  }, [pushHistory, setNodes]);

  const deleteNode = useCallback((id) => {
    pushHistory();
    setNodes((ns) => ns.filter((n) => n.id !== id && n.parentId !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, [pushHistory, setNodes, setEdges]);

  const addNodeAt = useCallback((type, flow, connectFrom) => {
    pushHistory();
    const node = { id: newId(), type, position: flow, data: defaultData(type) };
    if (type === "group") { node.style = { width: 300, height: 200 }; node.zIndex = 0; }
    setNodes((ns) => ns.concat(node));
    if (connectFrom) setEdges((es) => addEdge({ ...EDGE_OPTS, id: newId(), source: connectFrom.nodeId, sourceHandle: connectFrom.handleId, target: node.id }, es));
    return node.id;
  }, [pushHistory, setNodes, setEdges]);

  // ── 연결 ──
  const onConnect = useCallback((params) => { pushHistory(); setEdges((es) => addEdge({ ...EDGE_OPTS, id: newId(), ...params }, es)); }, [pushHistory, setEdges]);
  const onConnectEnd = useCallback((event, state) => {
    if (state?.isValid) return; // 노드에 연결됨 → onConnect 가 처리
    const from = state?.fromNode; if (!from) return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : event;
    const flow = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    setKindPopup({ x: pt.clientX, y: pt.clientY, flow, connect: { nodeId: from.id, handleId: state.fromHandle?.id } });
  }, [rf]);

  // ── 더블클릭 빈 곳 → 노드 종류 팝업 ──
  const onPaneDblClick = useCallback((e) => {
    if (mobile) return;
    if (!(e.target.classList?.contains("react-flow__pane"))) return;
    const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setKindPopup({ x: e.clientX, y: e.clientY, flow });
  }, [rf, mobile]);

  // ── 도구로 클릭 배치 ──
  const onPaneClick = useCallback((e) => {
    setKindPopup(null); setCondEdit(null);
    if (mobile) return;
    if (["condition", "hero", "comp", "text", "group"].includes(tool)) {
      const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeAt(tool, flow);
      setTool("select");
    }
  }, [tool, rf, addNodeAt]);

  const pickKind = (type) => { if (!kindPopup) return; addNodeAt(type, kindPopup.flow, kindPopup.connect); setKindPopup(null); };
  // C2: 노드 종류 팝업 열렸을 때 키 1~4로 선택, Esc 닫기
  useEffect(() => {
    if (!kindPopup) return;
    const onKey = (e) => {
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) { e.preventDefault(); pickKind(NODE_KINDS[i].type); }
      else if (e.key === "Escape") setKindPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kindPopup]); // eslint-disable-line

  // ── 그룹 소속(드래그로 그룹 안/밖) ──
  const onNodeDragStart = useCallback(() => { pushHistory(); }, [pushHistory]);
  const onNodeDragStop = useCallback((_e, node) => {
    if (node.type === "group") return;
    const inter = rf.getIntersectingNodes(node).filter((n) => n.type === "group");
    const grp = inter[0];
    setNodes((ns) => ns.map((n) => {
      if (n.id !== node.id) return n;
      if (grp && n.parentId !== grp.id) {
        const gp = ns.find((x) => x.id === grp.id);
        return { ...n, parentId: grp.id, extent: "parent", position: { x: n.position.x - gp.position.x, y: n.position.y - gp.position.y } };
      }
      if (!grp && n.parentId) {
        const gp = ns.find((x) => x.id === n.parentId);
        return { ...n, parentId: undefined, extent: undefined, position: { x: n.position.x + (gp?.position.x || 0), y: n.position.y + (gp?.position.y || 0) } };
      }
      return n;
    }));
  }, [rf, setNodes]);

  // ── 키보드 ──
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); const sel = nodes.filter((n) => n.selected); if (sel.length) { pushHistory(); setNodes((ns) => ns.concat(sel.map((s) => ({ ...s, id: newId(), position: { x: s.position.x + 28, y: s.position.y + 28 }, data: JSON.parse(JSON.stringify(s.data || {})), selected: false })))); } return; }
      if (mod && e.key === "0") { e.preventDefault(); rf.fitView({ duration: 200, padding: 0.2 }); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        const selN = nodes.filter((n) => n.selected), selE = edges.filter((ed) => ed.selected);
        if (selN.length || selE.length) { e.preventDefault(); pushHistory(); const ids = new Set(selN.map((n) => n.id)); setNodes((ns) => ns.filter((n) => !ids.has(n.id) && !ids.has(n.parentId))); setEdges((es) => es.filter((ed) => !ed.selected && !ids.has(ed.source) && !ids.has(ed.target))); }
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const sel = nodes.filter((n) => n.selected); if (!sel.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        const now = Date.now(); if (now - arrowTs.current > 600) { pushHistory(); } arrowTs.current = now;
        const ids = new Set(sel.map((n) => n.id));
        setNodes((ns) => ns.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + d[0], y: n.position.y + d[1] } } : n)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, edges, undo, redo, pushHistory, setNodes, setEdges, rf]);

  const ctxVal = useMemo(() => ({
    lang: language, updateNodeData, updateEdgeData, duplicateNode, deleteNode,
    openHeroPicker: (nodeId, opt) => setPicker({ nodeId, ...(opt || {}) }),
    openCondEdit: (nodeId) => setCondEdit({ nodeId }),
  }), [language, updateNodeData, updateEdgeData, duplicateNode, deleteNode]);

  const onPickHero = (heroId) => {
    if (!picker) return;
    const { nodeId, slotIndex } = picker;
    if (typeof slotIndex === "number") {
      pushHistory();
      setNodes((ns) => ns.map((n) => { if (n.id !== nodeId) return n; const slots = [...(n.data.slots || [null, null, null, null, null])]; slots[slotIndex] = heroId; return { ...n, data: { ...n.data, slots } }; }));
    } else {
      updateNodeData(nodeId, { heroId }, true);
    }
    setPicker(null);
  };

  const showMinimap = nodes.length >= 20; // C5: 노드 ≥20일 때만
  const empty = doc.loaded && nodes.length === 0;

  return (
    <CanvasCtx.Provider value={ctxVal}>
      <TopBar boardName={boardName} mapRow={mapRow} onBack={onBack}
        saveStatus={doc.saveStatus} savedAt={doc.savedAt} onRetry={doc.retrySave}
        undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
        snap={snap} setSnap={setSnap} onExport={() => setExportOpen(true)} lang={language} />
      {strip}
      {doc.serverNewer && (
        <div className="pl-banner warn">
          <span>{t.updatedElsewhere(doc.serverUpdatedAt ? formatRelative(doc.serverUpdatedAt, language) : "")}</span>
          <button className="pl-banner-btn" onClick={doc.dismissServerNewer}>{t.done}</button>
        </div>
      )}
      {doc.hasBackup && (
        <div className="pl-banner">
          <span>{t.recoverTitle}</span>
          <button className="pl-banner-btn" onClick={doc.applyBackup}>{t.recover}</button>
          <button className="pl-banner-btn" onClick={doc.discardBackup}>{t.discard}</button>
        </div>
      )}
      <div className="pl-canvas-area" ref={wrapRef} onDoubleClick={onPaneDblClick}>
        {!mobile && <Toolbar tool={tool} setTool={setTool} lang={language} />}
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultEdgeOptions={EDGE_OPTS}
          onConnect={onConnect} onConnectEnd={onConnectEnd}
          onPaneClick={onPaneClick} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
          onNodeClick={mobile ? ((_e, n) => setMobileDetail(n)) : undefined}
          nodesDraggable={!mobile} nodesConnectable={!mobile} elementsSelectable={!mobile}
          snapToGrid={snap} snapGrid={[8, 8]}
          panOnDrag={mobile ? true : (tool === "hand" ? true : [1, 2])} selectionOnDrag={!mobile && tool === "select"}
          panActivationKeyCode="Space" multiSelectionKeyCode="Shift" deleteKeyCode={null}
          zoomOnDoubleClick={false}
          fitView minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }}
          data-testid="rf" className={"pl-rf" + (tool === "hand" ? " hand" : "")}
        >
          <Background gap={16} size={1} color="var(--pl-border)" />
          <Controls showInteractive={false} />
          {showMinimap && <MiniMap pannable zoomable nodeColor="#3f3f46" maskColor="rgba(0,0,0,.5)" />}
        </ReactFlow>

        {empty && !tplOpen && (
          <div className="pl-empty-overlay"><div className="pl-empty-card"><b>{t.emptyTitle}</b><div>{t.emptyHint}</div></div></div>
        )}

        {kindPopup && !mobile && (
          <div className="pl-kind-popup" style={{ left: kindPopup.x, top: kindPopup.y }} onMouseLeave={() => setKindPopup(null)}>
            {NODE_KINDS.map((k) => (
              <button key={k.type} onClick={() => pickKind(k.type)}><kbd>{k.key}</kbd> {k.label[language]}</button>
            ))}
          </div>
        )}
        {mobile && <div className="pl-mobile-note">{t.mobileView}</div>}
      </div>

      {picker && (
        <HeroPicker lang={language} defaultRole={picker.role} onPick={onPickHero} onClose={() => setPicker(null)} />
      )}
      {mobileDetail && (
        <div className="plan-modal-backdrop" onClick={() => setMobileDetail(null)}>
          <div className="plan-modal sm" onClick={(e) => e.stopPropagation()}>
            <div className="plan-modal-head">{t[mobileDetail.type] || mobileDetail.type}
              <button className="plan-modal-close" onClick={() => setMobileDetail(null)}>✕</button>
            </div>
            <div className="plan-modal-body" style={{ fontSize: 14 }}>
              {mobileDetail.type === "text" ? (
                <><b>{mobileDetail.data?.title}</b><div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{mobileDetail.data?.body}</div></>
              ) : mobileDetail.type === "condition" ? (
                <>{COND_TYPES[mobileDetail.data?.condType]?.label[language]} — {mobileDetail.data?.heroId || mobileDetail.data?.text || "—"}</>
              ) : mobileDetail.type === "comp" ? (
                (mobileDetail.data?.slots || []).map((s, i) => s || "·").join(" / ")
              ) : (
                mobileDetail.data?.heroId || mobileDetail.data?.label || "—"
              )}
            </div>
          </div>
        </div>
      )}
      {condEdit && (() => {
        const node = nodes.find((n) => n.id === condEdit.nodeId); if (!node) return null;
        return <CondEditor node={node} lang={language}
          onType={(ct) => updateNodeData(node.id, { condType: ct }, true)}
          onText={(tx) => updateNodeData(node.id, { text: tx, heroId: null })}
          onHero={() => { setCondEdit(null); setPicker({ nodeId: node.id }); }}
          onClose={() => setCondEdit(null)} />;
      })()}
      {tplOpen && (
        <div className="plan-modal-backdrop" onClick={() => chooseTemplate("empty")}>
          <div className="plan-modal sm" onClick={(e) => e.stopPropagation()}>
            <div className="plan-modal-head">{t.tplTitle}</div>
            <div className="plan-modal-body">
              {TEMPLATE_KINDS.map((k) => (
                <button key={k.id} className="plan-btn" style={{ width: "100%", textAlign: "left", marginBottom: 8, display: "block" }} onClick={() => chooseTemplate(k.id)}>
                  <b>{t[k.labelKey]}</b>{k.descKey && <div style={{ fontSize: 12, opacity: .7, marginTop: 2 }}>{t[k.descKey]}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {exportOpen && (
        <div className="plan-modal-backdrop" onClick={() => setExportOpen(false)}>
          <div className="plan-modal sm" onClick={(e) => e.stopPropagation()}>
            <div className="plan-modal-head">{t.exportTitle}</div>
            <div className="plan-modal-body">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> {t.transparentBg}
              </label>
            </div>
            <div className="plan-modal-foot">
              <button className="plan-btn" onClick={() => setExportOpen(false)}>{t.cancel}</button>
              <button className="plan-btn primary" onClick={onExport}>{t.exportPng}</button>
            </div>
          </div>
        </div>
      )}
    </CanvasCtx.Provider>
  );
}

// 조건 노드 편집 팝오버(유형·영웅·텍스트)
function CondEditor({ node, lang, onType, onText, onHero, onClose }) {
  const t = planT(lang);
  return (
    <div className="plan-modal-backdrop" onClick={onClose}>
      <div className="plan-modal sm" onClick={(e) => e.stopPropagation()}>
        <div className="plan-modal-head">{t.condition}
          <button className="plan-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="plan-modal-body">
          <div className="plan-modetabs">
            {COND_ORDER.map((ct) => (
              <button key={ct} className={"plan-modetab" + (node.data.condType === ct ? " active" : "")} style={node.data.condType === ct ? { background: COND_TYPES[ct].color, borderColor: COND_TYPES[ct].color, color: "#fff" } : {}} onClick={() => onType(ct)}>{COND_TYPES[ct].label[lang]}</button>
            ))}
          </div>
          <button className="plan-btn" style={{ width: "100%", marginBottom: 8 }} onClick={onHero}>{t.pickHero}</button>
          <textarea className="plan-search" style={{ minHeight: 60 }} placeholder={lang === "ko" ? "텍스트(선택)" : "text"} value={node.data.text || ""} onChange={(e) => onText(e.target.value)} />
        </div>
        <div className="plan-modal-foot"><button className="plan-btn primary" onClick={onClose}>{t.done}</button></div>
      </div>
    </div>
  );
}

export default function PlanCanvas(props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
export { Flow, defaultData, newId, EDGE_OPTS };
