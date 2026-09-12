"use client";

import { useEffect, useState } from 'react';
import { backend } from '@/lib/api';

/** Reuses the original character page's input, caption and button styles. */
export function PersonalMemory({ characterId }: { characterId: number }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [results, setResults] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void backend.licenseBinding(characterId).then(async binding => {
      if (!binding) return;
      const pending = await (await import('@/lib/memory')).pendingMemoryText(binding.listingId);
      if (active && pending) { setText(pending); setMessage('이전 기억의 저장 결과를 확인해주세요.'); }
    }).catch(() => { if (active) setMessage('기억을 확인하지 못했어요. 다시 시도해주세요.'); });
    return () => { active = false; };
  }, [characterId, open]);
  async function run(save: boolean) {
    if (busy || !text.trim() || (save && !consent)) return;
    setBusy(true); setMessage('');
    try {
      const binding = await backend.licenseBinding(characterId);
      if (!binding) throw Error('이 캐릭터의 기억을 확인할 수 없어요.');
      const memory = await import('@/lib/memory');
      if (save) { await memory.rememberApproved(binding, text.trim()); setMessage('기억을 저장했어요.'); setText(''); setConsent(false); }
      else { const found = await memory.recallMemory(binding.listingId, text.trim()); setResults(found.results.map(r => r.text)); setMessage(found.results.length ? '' : '관련된 기억이 없어요.'); }
    } catch (e) { setMessage(e instanceof Error ? e.message : '기억을 확인하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <section style={{ marginTop: 24 }}>
    <button className="cp-btnGhost" type="button" onClick={() => setOpen(v => !v)}>나의 기억</button>
    {open && <div className="cp-callBox">
      <label className="label1" htmlFor="personal-memory">기억할 내용 또는 찾고 싶은 이야기</label>
      <textarea id="personal-memory" className="input" maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={busy} />
      <label className="caption"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />
        이 내용의 저장과 대화 활용에 동의해요.</label>
      <p className="caption">선택한 내용만 암호화해 저장해요. 저장·검색 서비스와 AI는 처리 중 내용을 볼 수 있어요.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="cp-btnGhost" type="button" disabled={busy || !text.trim()} onClick={() => void run(false)}>찾기</button>
        <button className="cp-btnFill" type="button" disabled={busy || !consent || !text.trim()} onClick={() => void run(true)}>{busy ? '처리 중…' : '저장'}</button>
      </div>
      {results.map((result, i) => <p className="body2" key={i}>{result}</p>)}
      <button className="cp-btnGhost" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await (await import('@/lib/memory')).disableMemory(); setResults([]); setMessage('저장과 대화 활용을 껐어요. 기존 기억은 삭제되지 않아요.'); }
        catch { setMessage('변경하지 못했어요. 다시 시도해주세요.'); }
        finally { setBusy(false); }
      }}>기억 활용 끄기</button>
      {message && <p className="caption" role="status">{message}</p>}
    </div>}
  </section>;
}
