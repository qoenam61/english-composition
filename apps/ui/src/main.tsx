import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTts } from "./tts";
import "./index.css";
void initTts();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
