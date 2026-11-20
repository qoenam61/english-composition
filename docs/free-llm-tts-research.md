# 무료 LLM·TTS 조사와 설정 (2026-11-20)

> 숫자는 제3자 블로그 기준이며 제공사가 예고 없이 바꾼다. 쓰기 전에 각 공식 문서에서 다시 확인할 것.

## 1. 채점·정정·코멘트(LLM 판정) — 현재 구성
- **기본 순서(2026-11-20 개정): Groq qwen3.8-27b → Gemini flash-lite(자동 선택) → Groq gpt-oss-120b → Groq gpt-oss-20b → claude haiku(마지막 비상용)** (`JUDGE_CHAIN=groq-qwen,gemini,groq-120b,groq-20b,claude`). 키가 없는 단계는 건너뛰고, 한도·오류가 난 단계는 60초 쉬고 다음으로 넘어간다. 판정·정정·한 줄 코멘트는 같은 호출 하나에서 나온다.
- Groq 한도는 모델별로 따로 계산된다(실측: 각 하루 1,000회, 분당 8,000토큰). 세 모델을 이으면 하루 약 3,000회. Gemini 키는 `.env`의 `GOOGLE_AI_STUDIO_API_KEY`.
- 8건 시험(정답이 분명한 사례): qwen 7/8·평균 0.28초, gpt-oss-120b 7/8·0.55초, gpt-oss-20b 6/8·0.46초(정답을 오답 처리, 응답 해석 1건 실패). 표본이 작아 참고용.
- claude 모델은 haiku(`JUDGE_MODEL`로 변경). 구독 한도를 쓰되 호출당 토큰이 작다.
- 무료 외부 LLM을 앞에 붙이는 설정(OpenAI 호환 API라면 어디든 가능):
  ```
  JUDGE_CHAIN=openai,claude          # 앞에서부터 시도, 실패·한도 시 다음으로
  JUDGE_BASE_URL=https://api.groq.com/openai/v1
  JUDGE_API_KEY=<환경변수로만, 코드·git에 넣지 않는다>
  JUDGE_API_MODEL=openai/gpt-oss-120b
  ```

## 2. 무료 LLM 후보 비교
| 후보 | 무료 한도(보도된 값) | 장점 | 주의 |
|---|---|---|---|
| Groq | 모델별. gpt-oss-120b 기준 분당 30회·일 1,000회·일 20만 토큰, 카드 불필요 | 빠르고 OpenAI 호환 | 모델별 한도라 모델을 바꾸면 한도도 바뀜 |
| Google Gemini | 가장 넉넉(일 1,500회급으로 보도됨) | 토큰량 풍부 | **무료 구간 입력은 제품 개선에 쓰이고 사람이 읽을 수 있다고 약관에 명시** — 구매한 원문 문장을 보내기엔 부적절 |
| OpenRouter `:free` | 분당 20회·일 50회(10달러 충전 시 일 1,000회) | 모델 선택 폭 | 일 50회로는 부족, 무료 모델 ID가 사라질 수 있음 |
| Cerebras·Cloudflare Workers AI·Mistral·Cohere·NVIDIA | 상시 무료 구간 있음 | 대안 | 한도·약관 개별 확인 필요 |

**추천**
1. 1단계(개인 학습): `JUDGE_CHAIN=openai,claude` — Groq를 먼저 쓰고 실패하면 claude haiku. 한 사람의 하루 사용량(수십~수백 건)이면 무료 한도 안에 들어온다고 본다(미측정).
2. 원문 저작권 때문에 **Gemini 무료 구간은 쓰지 않는 것**을 권한다(입력이 약관상 학습·검토 대상).
3. 2단계(무료 공개)·3단계: 무료 구간은 키 하나당 한도라 사용자가 늘면 못 버틴다. 로컬 코드 판정으로 대부분을 끝내고(현재도 일치 시 LLM 미호출), 나머지는 저가 유료 API로 설계해야 한다.
4. 품질은 모델마다 다르다. 외부 모델로 바꾸면 "정답(패턴 미카운트)" 구분이 맞는지 샘플 점검이 필요하다(아직 미측정).

## 3. TTS 후보
| 후보 | 특징 | 비고 |
|---|---|---|
| 브라우저 내장(Web Speech) | 무료·설치 없음 | 기기·브라우저마다 음질 편차, 자동재생 차단 가능. **현재 기본값** |
| **Kokoro**(Apache 2.0) | 82M 파라미터, CPU에서도 동작, 영어 품질 평가 최상위 | 자체 서버 필요. **추천** |
| Piper | 저사양용, 100개+ 음성 | 자연스러움은 Kokoro보다 낮고 음성별 라이선스 확인 필요 |
| Chatterbox(MIT)·Qwen3-TTS(Apache 2.0) | 더 자연스러움 | GPU 필요(6GB+ VRAM) |
| edge-tts | 무료지만 Microsoft 온라인 서비스를 비공식으로 호출 | 자체 호스팅 아님, 약관·안정성 위험 → 비추천 |

**추천**: 개인 학습은 Kokoro(로컬 서버)로 전환, 공개 단계에서는 문장 음성을 **미리 생성해 파일로 배포**(문장 수가 고정이라 가능)하면 서버 비용과 지연이 없다.

## 4. TTS 전환 설정
기본 순서: **Kokoro(로컬 서버) → 브라우저 음성** (`TTS_CHAIN=kokoro,browser`). 브라우저 음성만 쓰려면 `TTS_CHAIN=browser`.
```
TTS_CHAIN=kokoro,browser    # 기본
TTS_URL=http://127.0.0.1:8880/v1   # OpenAI 호환 TTS 서버(예: Kokoro-FastAPI)
TTS_VOICE_Q=af_heart        # 질문 목소리
TTS_VOICE_A=am_adam         # 답변 목소리(질문과 다르게)
TTS_MODEL=kokoro
```
서버 음성이 실패(엔진 없음·자동재생 차단)하면 자동으로 브라우저 음성으로 대신하고, 그래도 안 되면 타이머가 시간 초과 안전장치로 시작된다.
Kokoro 서버는 이 컴퓨터에 설치돼 있지 않다(설치·실음성 확인은 하지 않음).

## 출처
- [Free LLM APIs Compared (OpenRouter)](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)
- [Free LLM API Comparison 2026 (Novita)](https://blogs.novita.ai/free-llm-api-comparison-2026/)
- [12 Free LLM APIs (DEV)](https://dev.to/tokenmixai/12-free-llm-apis-you-can-use-right-now-no-credit-card-real-limits-tested-13f8)
- [Best open source TTS 2026](https://findskill.ai/blog/best-open-source-tts-2026/)
- [Speech synthesis comparison guide](https://codesota.com/guides/tts-models)
- [Best open-source speech models](https://www.codesota.com/speech/best-open-source)

## 5. Kokoro 설치 현황 (2026-11-20)
- 위치 `~/kokoro-tts`(독립 파이썬 3.12 환경, Docker·이 리포와 분리). 서버 코드 사본: `docs/kokoro-server.py`. `127.0.0.1:8880`에만 열림.
- 로그인 시 자동 시작: launchd `com.kokoro.tts`(`~/Library/LaunchAgents/com.kokoro.tts.plist`). 끄기: `launchctl bootout gui/$(id -u)/com.kokoro.tts` 후 plist 삭제, 폴더 삭제로 완전 제거.
- 응답 형식은 wav. 문장당 약 0.5~0.9초(CPU). 질문 `af_heart`(여성), 답변 `am_michael`(남성, `TTS_VOICE_A`로 변경. 후보: am_adam·am_eric·am_liam·am_onyx).
- 앱 서버는 시작 후 30초 간격으로 Kokoro 생존을 확인하고, 꺼져 있으면 브라우저 음성으로 대신한다.
