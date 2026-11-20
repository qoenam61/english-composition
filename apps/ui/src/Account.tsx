import { useEffect, useState } from "react";
import { AdminPanel } from "./Admin";
import { Btn, Card, Modal } from "./ui";

export interface Who { admin?: boolean; authed?: boolean; account: string; loggedIn: boolean; loginMethod: string | null; sessionAccount: string | null; providers: Array<{ name: string; label: string; enabled?: boolean }> }
const METHOD: Record<string, string> = { google: "Google", kakao: "카카오", naver: "네이버", github: "GitHub", discord: "Discord", microsoft: "Microsoft", facebook: "Facebook" };

export function useWho() {
  const [who, setWho] = useState<Who | null>(null);
  useEffect(() => { void fetch("/api/whoami").then((r) => r.json() as Promise<Who>).then(setWho).catch(() => {}); }, []);
  return who;
}

function ProviderButton({ p, admin }: { p: Who["providers"][number]; admin?: boolean }) {
  if (p.enabled) return <a href={`/auth/${p.name}/start`} className="block text-center rounded-xl bg-card border-2 border-cardb text-t1 font-bold py-3">{p.label}로 계속하기</a>;
  return <div className="text-center rounded-xl bg-surface border-2 border-cardb text-t3 font-bold py-3 opacity-60">{p.label}{admin ? " · 키 설정 필요" : " · 준비 중"}</div>;
}

/** 로그인이 필요한 메뉴를 비로그인으로 열었을 때 보이는 안내. */
export function LockedView({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="max-w-md mx-auto p-6 grid gap-3 text-center">
      <div className="text-4xl">🔒</div>
      <div className="font-black text-t1 text-lg">로그인하면 쓸 수 있어요</div>
      <p className="text-sm text-t3">챕터 학습, 오답노트, 학습완료는 로그인한 계정에 저장돼요. 로그인하지 않아도 자유훈련은 바로 할 수 있어요(기록은 남지 않아요).</p>
      <Btn tone="green" onClick={onLogin}>로그인</Btn>
    </div>
  );
}

/** 우측 상단 계정 버튼과 계정 창. 로그인은 이 버튼을 눌렀을 때만 시작한다. */
export function AccountButton({ who, open, setOpen }: { who: Who | null; open: boolean; setOpen: (v: boolean) => void }) {
  const [failed, setFailed] = useState(() => location.search.includes("login=failed")); const [armed, setArmed] = useState(false);
  useEffect(() => { if (failed) { setOpen(true); history.replaceState(null, "", location.pathname + location.hash); } }, [failed, setOpen]);
  const post = async (path: string) => { await fetch(path, { method: "POST" }); location.reload(); };
  const label = !who ? "로그인" : who.admin && !who.loggedIn ? "관리자" : who.loggedIn ? `${who.admin ? "관리자 · " : ""}${METHOD[who.loginMethod ?? ""] ?? "내 계정"}` : "로그인";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`rounded-lg px-3 py-1 text-xs font-extrabold border-b-2 border-app whitespace-nowrap ${who?.authed ? "bg-surface text-t2" : "bg-green text-white"}`}>👤 {label}</button>
      <Modal open={open} onClose={() => { setOpen(false); setFailed(false); setArmed(false); }}>
        <Card className="p-5 grid gap-3 text-left">
          <div className="font-black text-t1 text-lg">{who?.loggedIn ? "내 계정" : "로그인"}</div>
          {failed && <div className="rounded-xl bg-red/10 border border-red/40 text-red px-3 py-2 text-sm font-bold">로그인하지 못했어요. 다시 시도해 주세요.</div>}
          {!who?.authed && <p className="text-sm text-t3">로그인하면 진도·오답노트·학습완료가 내 계정에 저장돼요. 이름이나 이메일은 저장하지 않아요.</p>}
          {who?.admin && !who.loggedIn && <p className="text-sm text-t3">이 컴퓨터에서 직접 접속해 관리자로 쓰는 중이에요.</p>}
          {who?.loggedIn && <p className="text-sm text-t3">{METHOD[who.loginMethod ?? ""] ?? "소셜"} 계정으로 로그인했어요.</p>}
          {who && !who.authed && who.providers.map((p) => <ProviderButton key={p.name} p={p} admin={who.admin} />)}
          {who && !who.authed && !who.providers.some((p) => p.enabled) && <p className="text-xs text-t3">아직 로그인 방법이 설정되지 않았어요.</p>}
          {who?.admin && !who.loggedIn && who.providers.every((p) => !p.enabled) && <p className="text-xs text-t3">관리자 안내: .env 의 OAUTH_… 키를 채우면 해당 로그인 버튼이 켜져요.</p>}
          {who?.admin && <AdminPanel />}
          {who?.loggedIn && <Btn tone="sky" onClick={() => void post("/auth/logout")}>로그아웃</Btn>}
          {who?.loggedIn && (armed
            ? <Btn tone="red" onClick={() => void post("/api/account/delete")}>정말 탈퇴하고 내 기록 모두 삭제</Btn>
            : <button type="button" className="text-red text-sm font-bold text-left" onClick={() => setArmed(true)}>회원 탈퇴…</button>)}
          {armed && <p className="text-xs text-t3">탈퇴하면 내 진도, 오답노트, 학습완료가 영구 삭제되고 되돌릴 수 없어요.</p>}
          {who?.loggedIn && who.sessionAccount && <p className="text-[11px] text-t3 break-all">계정 ID: {who.sessionAccount}</p>}
          <Btn tone="sky" onClick={() => setOpen(false)}>닫기</Btn>
        </Card>
      </Modal>
    </>
  );
}
