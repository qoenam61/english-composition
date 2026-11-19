# iOS/Android 패키징 기술 검토 (5줄 요약)

1. **가능**: 현재 UI는 순수 웹(React+Vite)이라 Capacitor로 그대로 감쌀 수 있다. 서버 API(`/api/*`)는 앱에서 접근 가능한 주소(공개 도메인+인증)로 바꿔야 한다.
2. **키보드·뷰포트**: `100dvh`, `safe-area-inset`, 16px 입력창, 입력 중 하단 탭 숨김은 적용했다. 실기기(iOS WKWebView, Android WebView)에서 키보드가 올라올 때 입력창이 가려지는지 확인하고 Capacitor Keyboard 플러그인 설정(`resize`)을 맞춘다.
3. **입력 제어**: `autoCapitalize/autoCorrect/spellCheck` 끔은 적용했다. 한글 IME 조합 중 Enter 제출(`isComposing`)은 처리했고, 안드로이드 키보드별 동작은 실기기 확인이 필요하다.
4. **TTS/음성**: 아직 없다. Web Speech 대신 Capacitor 플러그인(TextToSpeech, SpeechRecognition)을 브릿지로 붙일 예정이며 오프라인 동작은 별도 설계가 필요하다.
5. **스토어 심사**: 로그인·계정 삭제 경로, 개인정보 처리방침, 유료화 시 인앱결제(IAP) 의무, 원본 콘텐츠 저작권(구매한 Sentence Kit 원문은 공개 앱에 넣을 수 없음)을 출시 전에 점검한다.
