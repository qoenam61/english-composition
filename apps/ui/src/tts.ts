/** 음성 안내(TTS). 브라우저 speechSynthesis 를 쓰며, 어떤 경우에도 Promise 가 반드시 끝나도록(종료·오류·취소·시간 초과) 안전장치를 둔다. */
const KEY = "epa.tts";
let provider: "browser" | "server" = "browser"; // 서버 설정(/api/config)이 정한다. server 면 서버의 TTS 엔진(예: 로컬 Kokoro) 음성을 쓴다.
export async function initTts(): Promise<void> { try { const c = (await (await fetch("/api/config")).json()) as { tts?: string }; provider = c.tts === "server" ? "server" : "browser"; } catch { /* 설정을 못 읽으면 브라우저 음성 */ } }
const browserOk = () => typeof window !== "undefined" && "speechSynthesis" in window;
export const ttsSupported = () => browserOk() || provider === "server";
export function ttsEnabled(): boolean { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } }
export function setTtsEnabled(on: boolean): void { if (on) unlockAudio(); try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* 저장 불가여도 동작은 한다 */ } if (!on) cancelSpeech(); }

let epoch = 0; // 올라가면 진행 중인 재생 대기열은 모두 무효
// 모바일 브라우저는 "사용자가 직접 누른 순간"에만 소리를 허용한다. 그래서 첫 터치에서 공용 오디오 요소와 음성 합성을 미리 열어 둔다(이후 비동기 재생 허용).
const player: HTMLAudioElement | null = typeof Audio !== "undefined" ? new Audio() : null;
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let unlocked = false;
export function unlockAudio(): void {
  if (unlocked) return; unlocked = true;
  try { if (player) { player.src = SILENT; void player.play().catch(() => { unlocked = false; }); } } catch { unlocked = false; }
  try { if (browserOk()) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); window.speechSynthesis.getVoices(); } } catch { /* 무시 */ }
}
if (typeof window !== "undefined") for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, unlockAudio, { once: false, passive: true });
const enVoice = (): SpeechSynthesisVoice | undefined => { try { const v = window.speechSynthesis.getVoices(); return v.find((x) => x.lang === "en-US") ?? v.find((x) => x.lang.startsWith("en")); } catch { return undefined; } };
let serverDownUntil = 0; // 서버 음성이 실패하면 이 시각까지는 브라우저 음성으로 바로 간다
const finishers = new Set<() => void>(); let audio: HTMLAudioElement | null = null;
export function cancelSpeech(): void {
  epoch++; if (browserOk()) window.speechSynthesis.cancel();
  if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio = null; }
  [...finishers].forEach((f) => f()); // 기다리던 재생을 즉시 끝낸 것으로 풀어 준다(타이머가 멈춰 있지 않게)
}

/** 한 문장을 읽고 끝나면 resolve. 오류·취소·자동재생 차단으로 종료 이벤트가 안 와도 시간 초과 시 resolve 한다. */
export type Role = "q" | "a"; // q=질문하는 사람, a=답하는 사람(목소리를 다르게 한다)
/** 영어 음성 중 질문용·답변용을 서로 다른 것으로 고른다(하나뿐이면 같은 음성에 음높이만 달리한다). */
function pickVoice(role: Role): SpeechSynthesisVoice | undefined {
  try {
    const all = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    const us = all.filter((v) => v.lang === "en-US"); const pool = us.length >= 2 ? us : all;
    if (pool.length === 0) return undefined;
    return role === "q" ? pool[0] : pool[1] ?? pool[0];
  } catch { return undefined; }
}
const PITCH: Record<Role, number> = { q: 1.15, a: 0.85 }; // 같은 음성일 때도 다르게 들리도록
export function speak(text: string, role: Role = "q"): Promise<void> {
  if (!ttsSupported() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false; const finish = () => { if (!done) { done = true; clearTimeout(timer); finishers.delete(finish); resolve(); } };
    finishers.add(finish);
    const words = text.trim().split(/\s+/).length;
    const timer = setTimeout(finish, 3500 + words * 700); // 안전장치: 이 시간이 지나면 끝난 것으로 본다
    const browserSpeak = () => { if (!browserOk()) return finish(); try { const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = 0.95; u.pitch = PITCH[role]; const v = pickVoice(role) ?? enVoice(); if (v) u.voice = v; u.onend = finish; u.onerror = finish; window.speechSynthesis.resume(); window.speechSynthesis.speak(u); } catch { finish(); } };
    if (provider === "server" && Date.now() >= serverDownUntil) { // 서버 음성: 재생 실패(자동재생 차단·서버 오류)면 브라우저 음성으로 대신한다
      try { const a = player ?? new Audio(); a.src = "/api/tts?role=" + role + "&text=" + encodeURIComponent(text); audio = a; const fall = () => { serverDownUntil = Date.now() + 60_000; browserSpeak(); }; a.onended = finish; a.onerror = fall; void a.play().catch(fall); } catch { browserSpeak(); }
      return;
    }
    if (provider === "server") return browserSpeak(); // 서버 음성이 최근 실패했으면 60초간 바로 브라우저 음성
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = 0.95; u.pitch = PITCH[role]; const v = pickVoice(role) ?? enVoice(); if (v) u.voice = v;
      u.onend = finish; u.onerror = finish;
      window.speechSynthesis.resume(); window.speechSynthesis.speak(u);
    } catch { finish(); }
  });
}

/** 순차 재생: 문자열은 읽고, 숫자는 그만큼(ms) 쉰다. 도중에 cancelSpeech() 가 불리면 즉시 멈춘다. */
export async function speakSequence(items: Array<{ text: string; role: Role } | number>): Promise<void> {
  cancelSpeech(); const mine = epoch; // 이전 재생을 정리하고 새 대기열을 시작한다
  for (const it of items) {
    if (mine !== epoch) return;
    if (typeof it === "number") await new Promise((r) => setTimeout(r, it)); else await speak(it.text, it.role);
  }
}
