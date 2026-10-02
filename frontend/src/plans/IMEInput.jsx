// IMEInput / IMETextarea — 한글(IME) 조합 안전 입력. 조합 중에는 외부 state 반영을 미루고,
// 조합 끝(compositionend)에만 1회 반영 → 조합 중 부모 리렌더가 입력을 초기화해 자모가 분리되는 문제 방지.
// onChange(value, event) 로 "값"을 전달한다(기존 e.target.value 패턴 대체). Enter/Escape 는 조합 확정 중이면 무시.
import React, { forwardRef, useEffect, useRef, useState } from "react";

function useComposed(value, onChange) {
  const composing = useRef(false);
  const [local, setLocal] = useState(value ?? "");
  // 조합 중이 아닐 때만 외부 값과 동기화(조합 중 외부 변경이 입력을 덮어쓰지 않도록)
  useEffect(() => { if (!composing.current) setLocal(value ?? ""); }, [value]);
  const onInput = (e) => { const v = e.target.value; setLocal(v); if (!composing.current && onChange) onChange(v, e); };
  const onCompositionStart = () => { composing.current = true; };
  const onCompositionEnd = (e) => { composing.current = false; const v = e.target.value; setLocal(v); if (onChange) onChange(v, e); };
  const keyGuard = (onKeyDown) => (e) => {
    if (e.nativeEvent && e.nativeEvent.isComposing && (e.key === "Enter" || e.key === "Escape")) return; // 조합 확정 키는 무시
    if (onKeyDown) onKeyDown(e);
  };
  return { local, onInput, onCompositionStart, onCompositionEnd, keyGuard };
}

export const IMEInput = forwardRef(function IMEInput({ value, onChange, onKeyDown, ...rest }, ref) {
  const c = useComposed(value, onChange);
  return <input ref={ref} {...rest} value={c.local} onChange={c.onInput} onCompositionStart={c.onCompositionStart} onCompositionEnd={c.onCompositionEnd} onKeyDown={c.keyGuard(onKeyDown)} />;
});

export const IMETextarea = forwardRef(function IMETextarea({ value, onChange, onKeyDown, ...rest }, ref) {
  const c = useComposed(value, onChange);
  return <textarea ref={ref} {...rest} value={c.local} onChange={c.onInput} onCompositionStart={c.onCompositionStart} onCompositionEnd={c.onCompositionEnd} onKeyDown={c.keyGuard(onKeyDown)} />;
});
