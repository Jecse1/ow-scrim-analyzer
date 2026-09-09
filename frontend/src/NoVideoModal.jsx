import React, { useEffect } from 'react';
import { useTheme } from './ThemeContext';

export default function NoVideoModal({ open, onClose }) {
  const { theme } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: theme.bg,
          border: `1px solid ${theme.border}`,
          borderRadius: '16px',
          padding: '36px 40px',
          maxWidth: '360px',
          width: '100%',
          margin: '0 16px',
          textAlign: 'center',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>📹</div>
        <div style={{ fontSize: '17px', fontWeight: '700', color: theme.text, marginBottom: '8px' }}>
          영상 기록 없음
        </div>
        <div style={{ fontSize: '14px', color: theme.textSub, marginBottom: '24px', lineHeight: '1.6' }}>
          해당 경기는 영상 기록이 없습니다
        </div>
        <button
          onClick={onClose}
          style={{
            padding: '10px 32px',
            backgroundColor: theme.surfaceHighlight,
            border: `1px solid ${theme.borderHighlight}`,
            borderRadius: '10px',
            color: theme.text,
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          확인
        </button>
      </div>
    </div>
  );
}
