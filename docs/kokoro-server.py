"""Kokoro(ONNX, CPU) OpenAI 호환 음성 서버. 127.0.0.1 에만 열린다.
GET /v1/models, POST /v1/audio/speech {input, voice, response_format: wav}"""
import io
import threading

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel

app = FastAPI()
kokoro = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
lock = threading.Lock()  # 모델 호출은 한 번에 하나씩


class Req(BaseModel):
    model: str = "kokoro"
    input: str
    voice: str = "af_heart"
    response_format: str = "wav"
    speed: float = 1.0


@app.get("/v1/models")
def models():
    return {"data": [{"id": "kokoro"}]}


@app.post("/v1/audio/speech")
def speech(r: Req):
    text = r.input.strip()
    if not text or len(text) > 400:
        raise HTTPException(400, "bad input")
    if r.voice not in kokoro.get_voices():
        raise HTTPException(400, "unknown voice")
    with lock:
        samples, rate = kokoro.create(text, voice=r.voice, speed=r.speed, lang="en-us")
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), media_type="audio/wav")
