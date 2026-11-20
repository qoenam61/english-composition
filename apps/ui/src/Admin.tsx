import { useEffect, useState } from "react";
import { Btn } from "./ui";

interface U { userId: string; kind: string; attempts: number; passed: number; lastAt: number; completed: number; admin?: boolean; fixedAdmin?: boolean }
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };

/** 관리자 전용: 계정별 이용 현황. 학습 내용(입력 문장)은 보여 주지 않고 횟수만 본다. */
export function AdminPanel() {
  const [list, setList] = useState<U[] | null>(null); const [armed, setArmed] = useState<string | null>(null);
  const load = () => void fetch("/api/admin/users").then((r) => r.json() as Promise<{ users: U[] }>).then((d) => setList(d.users)).catch(() => {});
  useEffect(load, []);
  const promote = async (id: string, on: boolean) => { await fetch(`/api/admin/promote?id=${encodeURIComponent(id)}&on=${on ? 1 : 0}`, { method: "POST" }); load(); };
  const del = async (id: string) => { await fetch(`/api/admin/delete?id=${encodeURIComponent(id)}`, { method: "POST" }); setArmed(null); load(); };
  return (
    <div className="grid gap-2 border-t-2 border-cardb pt-3">
      <div className="font-black text-t1">관리자 · 계정 현황 {list && `(${list.length})`}</div>
      <div className="max-h-60 overflow-y-auto grid gap-1.5">
        {list?.map((u) => (
          <div key={u.userId} className="rounded-lg bg-surface px-3 py-2 text-xs grid gap-1">
            <div className="flex justify-between gap-2"><b className="text-t1">{u.kind}{u.admin ? " · 관리자" : ""}</b><span className="text-t3">{ago(u.lastAt)}</span></div>
            <div className="text-t3 break-all">{u.userId} · 시도 {u.attempts} · 정답 {u.passed} · 완료 {u.completed}</div>
            {u.userId.startsWith("u-") && !u.fixedAdmin && <button type="button" className="text-sky font-bold text-left" onClick={() => void promote(u.userId, !u.admin)}>{u.admin ? "관리자 해제" : "관리자로 지정"}</button>}
            {u.userId !== "me" && (armed === u.userId ? <Btn tone="red" className="py-1 text-xs" onClick={() => void del(u.userId)}>정말 이 계정의 기록 삭제</Btn> : <button type="button" className="text-red font-bold text-left" onClick={() => setArmed(u.userId)}>기록 삭제…</button>)}
          </div>
        ))}
        {list?.length === 0 && <p className="text-xs text-t3">아직 기록이 있는 계정이 없어요.</p>}
      </div>
    </div>
  );
}
