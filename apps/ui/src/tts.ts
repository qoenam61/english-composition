/** 음성 안내(TTS). 브라우저 speechSynthesis 를 쓰며, 어떤 경우에도 Promise 가 반드시 끝나도록(종료·오류·취소·시간 초과) 안전장치를 둔다. */
const KEY = "epa.tts";
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;
export function ttsEnabled(): boolean { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } }
export function setTtsEnabled(on: boolean): void { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* 저장 불가여도 동작은 한다 */ } if (!on) cancelSpeech(); }

let epoch = 0; // 올라가면 진행 중인 재생 대기열은 모두 무효
export function cancelSpeech(): void { epoch++; if (ttsSupported()) window.speechSynthesis.cancel(); }

/** 한 문장을 읽고 끝나면 resolve. 오류·취소·자동재생 차단으로 종료 이벤트가 안 와도 시간 초과 시 resolve 한다. */
export function speak(text: string): Promise<void> {
  if (!ttsSupported() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false; const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const words = text.trim().split(/\s+/).length;
    const timer = setTimeout(finish, 3500 + words * 700); // 안전장치: 이 시간이 지나면 끝난 것으로 본다
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = 0.95;
      u.onend = finish; u.onerror = finish;
      window.speechSynthesis.speak(u);
    } catch { finish(); }
  });
}

/** 순차 재생: 문자열은 읽고, 숫자는 그만큼(ms) 쉰다. 도중에 cancelSpeech() 가 불리면 즉시 멈춘다. */
export async function speakSequence(items: Array<string | number>): Promise<void> {
  const mine = ++epoch;
  if (ttsSupported()) window.speechSynthesis.cancel();
  for (const it of items) {
    if (mine !== epoch) return;
    if (typeof it === "number") await new Promise((r) => setTimeout(r, it)); else await speak(it);
  }
}
