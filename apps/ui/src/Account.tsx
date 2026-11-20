import { useEffect, useState } from "react";
import { AdminPanel } from "./Admin";
import { Btn, Card, Modal } from "./ui";

interface Who { admin?: boolean; ip: string; account: string; owner: boolean; loggedIn: boolean; loginMethod: string | null; sessionAccount: string | null; providers: Array<{ name: string; label: string }> }
const METHOD: Record<string, string> = { guest: "이 기기 전용 계정", google: "Google", kakao: "카카오", naver: "네이버", github: "GitHub", discord: "Discord", microsoft: "Microsoft", facebook: "Facebook" };

/** 계정 메뉴: 소셜 로그인(키가 설정된 제공사만), 이 기기 전용 계정, 로그아웃. 로그인하지 않으면 접속 IP 기준 계정으로 쓴다. */
export function AccountButton() {
  const [open, setOpen] = useState(false); const [who, setWho] = useState<Who | null>(null); const [failed, setFailed] = useState(() => location.search.includes("login=failed"));
  const load = () => void fetch("/api/whoami").then((r) => r.json() as Promise<Who>).then(setWho).catch(() => {});
  useEffect(load, []);
  useEffect(() => { if (failed) { setOpen(true); history.replaceState(null, "", location.pathname + location.hash); } }, [failed]);
  const post = async (path: string) => { await fetch(path, { method: "POST" }); location.reload(); };
  const label = !who ? "계정" : who.admin ? "관리자" : who.loggedIn ? (who.loginMethod === "guest" ? "게스트" : METHOD[who.loginMethod ?? ""] ?? "로그인됨") : who.admin ? "관리자" : who.owner ? "내 기록" : "로그인";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-surface text-t2 px-2.5 py-1 text-xs font-extrabold border-b-2 border-app whitespace-nowrap">👤 {label}</button>
      <Modal open={open} onClose={() => { setOpen(false); setFailed(false); }}>
        <Card className="p-5 grid gap-3 text-left">
          <div className="font-black text-t1 text-lg">계정</div>
          {failed && <div className="rounded-xl bg-red/10 border border-red/40 text-red px-3 py-2 text-sm font-bold">로그인하지 못했어요. 다시 시도해 주세요.</div>}
          <p className="text-sm text-t3">{who?.loggedIn ? `현재 ${METHOD[who.loginMethod ?? ""] ?? "로그인"} 계정으로 쓰는 중이에요.` : who?.owner ? "이 접속은 기존 학습 기록에 연결돼 있어요." : "로그인하지 않으면 접속한 네트워크(IP)로 기록을 구분해요. 네트워크가 바뀌면 기록이 다르게 보일 수 있어요."}</p>
          {who && !who.loggedIn && who.providers.map((p) => <a key={p.name} href={`/auth/${p.name}/start`} className="block text-center rounded-xl bg-card border-2 border-cardb text-t1 font-bold py-3">{p.label}로 계속하기</a>)}
          {who && !who.loggedIn && <Btn tone="sky" onClick={() => void post("/auth/guest")}>이 기기 전용 계정 만들기</Btn>}
          {who && !who.loggedIn && who.providers.length === 0 && <p className="text-xs text-t3">소셜 로그인은 아직 설정되지 않았어요.</p>}
          {who?.loggedIn && <Btn tone="red" onClick={() => void post("/auth/logout")}>로그아웃</Btn>}
          {who?.admin && <AdminPanel />}
          {who?.loggedIn && who.sessionAccount && <p className="text-[11px] text-t3 break-all">계정 ID: {who.sessionAccount}</p>}
          <Btn tone="sky" onClick={() => setOpen(false)}>닫기</Btn>
        </Card>
      </Modal>
    </>
  );
}
