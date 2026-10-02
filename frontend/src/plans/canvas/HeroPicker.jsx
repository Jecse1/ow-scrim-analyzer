// HeroPicker.jsx — 영웅 선택 패널(역할 탭·검색·최근 8명 localStorage). 밴픽 그리드 재사용 톤.
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { BANPICK_HEROES, getDisplayName } from "../../gameData";
import { HeroThumb, RoleIcon, ROLE_LABELS } from "../../shared/heroMapAssets";
import { planT } from "../i18n";

const RECENT_KEY = "plans.recentHeroes";
const ROLES = ["Tank", "Damage", "Support"];
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };
export const pushRecent = (id) => {
  try {
    const cur = readRecent().filter((x) => x !== id);
    cur.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 8)));
  } catch { /* ignore */ }
};

export default function HeroPicker({ lang, defaultRole, onPick, onClose }) {
  const t = planT(lang);
  const [role, setRole] = useState(defaultRole && ROLES.includes(defaultRole) ? defaultRole : "All");
  const [q, setQ] = useState("");
  const recent = useMemo(() => readRecent().map((id) => BANPICK_HEROES.find((h) => h.id === id)).filter(Boolean), []);

  const list = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return BANPICK_HEROES.filter((h) => {
      if (role !== "All" && h.role !== role) return false;
      if (!qn) return true;
      return getDisplayName(h.name, lang).toLowerCase().includes(qn) || h.id.toLowerCase().includes(qn);
    });
  }, [role, q, lang]);

  const pick = (id) => { pushRecent(id); onPick(id); };

  const Cell = ({ h }) => (
    <button className="pl-pick-cell" onClick={() => pick(h.id)} title={getDisplayName(h.name, lang)}>
      <div className="pl-pick-thumb"><HeroThumb id={h.id} /></div>
      <span className="pl-pick-name">{getDisplayName(h.name, lang)}</span>
    </button>
  );

  return (
    <div className="plan-modal-backdrop" onClick={onClose}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plan-modal-head">{t.pickHero || "영웅 선택"}
          <button className="plan-modal-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="plan-modal-body">
          <input className="plan-search" placeholder={t.searchHero || "영웅 검색…"} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="plan-modetabs">
            <button className={"plan-modetab" + (role === "All" ? " active" : "")} onClick={() => setRole("All")}>{t.allModes}</button>
            {ROLES.map((r) => (
              <button key={r} className={"plan-modetab" + (role === r ? " active" : "")} onClick={() => setRole(r)}>
                <RoleIcon role={r} lang={lang} className="pl-tab-roleicon" /> {ROLE_LABELS[lang][r]}
              </button>
            ))}
          </div>
          {recent.length > 0 && !q && (
            <>
              <div className="plan-pool-head">{t.recent || "최근"}</div>
              <div className="pl-pick-grid">{recent.map((h) => <Cell key={"r" + h.id} h={h} />)}</div>
              <div className="plan-pool-head">{ROLE_LABELS[lang] && role !== "All" ? ROLE_LABELS[lang][role] : (t.allHeroes || "전체")}</div>
            </>
          )}
          <div className="pl-pick-grid">{list.map((h) => <Cell key={h.id} h={h} />)}</div>
        </div>
      </div>
    </div>
  );
}
