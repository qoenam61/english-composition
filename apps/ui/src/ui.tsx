import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Tone = "green" | "sky" | "purple" | "gold" | "red" | "neutral" | "orange";
const TONE: Record<Tone, string> = {
  green: "bg-green border-green-d text-white", sky: "bg-sky border-sky-d text-white", purple: "bg-purple border-purple-d text-app",
  gold: "bg-gold border-gold-d text-app", red: "bg-red border-red-d text-white", orange: "bg-orange border-[#E08600] text-app", neutral: "bg-surface border-app text-[#CBD5E1]",
};
/** 3D 버튼: 눌릴 때 레이아웃이 흔들리지 않도록 border-b 를 투명으로 바꾸고 translate 만 쓴다. */
export function Btn({ tone = "green", className = "", ...p }: { tone?: Tone } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={`border-b-4 font-bold tracking-wide transition-all duration-100 rounded-xl select-none active:border-b-transparent active:translate-y-[4px] disabled:opacity-40 disabled:pointer-events-none px-4 py-3 ${TONE[tone]} ${className}`} />;
}
export const Card = ({ className = "", children }: { className?: string; children: ReactNode }) => <div className={`bg-card border-2 border-cardb rounded-2xl ${className}`}>{children}</div>;
export const Badge = ({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) => <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-extrabold border-b-2 ${TONE[tone]} ${className}`}>{children}</span>;

const ToastCtx = createContext<(msg: string, tone?: "ok" | "info" | "warn") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Array<{ id: number; msg: string; tone: string }>>([]);
  const push = useCallback((msg: string, tone: "ok" | "info" | "warn" = "info") => {
    const id = Date.now() + Math.random(); setList((l) => [...l.slice(-2), { id, msg, tone }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed left-0 right-0 top-16 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none" role="status" aria-live="polite">
        {list.map((t) => <div key={t.id} className={`toast-in rounded-xl border-2 px-4 py-2.5 text-sm font-bold shadow-lg ${t.tone === "ok" ? "bg-green/20 border-green text-green" : t.tone === "warn" ? "bg-gold/15 border-gold text-gold" : "bg-card border-cardb text-t2"}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => { if (!open) return; const f = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
export const fmtDate = (t: number) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
