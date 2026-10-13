import { useEffect, useState, useSyncExternalStore } from "react";
import { Glyph } from "./icons";
import { toast, toastError } from "./store";

/* ───────── gravador: tela da aba + voz (microfone) ─────────
   O estado vive neste módulo, não num componente: a gravação continua ao
   entrar e sair do modo apresentação. */

interface Rec {
  active: boolean;
  /** começou a pedir permissão, mas a gravação ainda não rodou */
  starting: boolean;
  wantMic: boolean;
  hasMic: boolean;
  startedAt: number;
}

let st: Rec = { active: false, starting: false, wantMic: true, hasMic: false, startedAt: 0 };
const subs = new Set<() => void>();
const patch = (p: Partial<Rec>) => {
  st = { ...st, ...p };
  subs.forEach((f) => f());
};
const useRec = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => st,
  );

let mr: MediaRecorder | null = null;
let streams: MediaStream[] = [];
let micTrack: MediaStreamTrack | null = null;
let ctx: AudioContext | null = null;
let touched = 0;

/** o prompt de compartilhamento tira o navegador da tela cheia; isso não deve encerrar a apresentação */
export const recordingGrace = () => st.starting || st.active || Date.now() - touched < 15000;

const pickMime = () =>
  ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) ?? "";

const release = () => {
  touched = Date.now();
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  micTrack = null;
  void ctx?.close().catch(() => {});
  ctx = null;
  mr = null;
  patch({ active: false, starting: false, hasMic: false });
};

export function stopRecording() {
  if (mr && mr.state !== "inactive") mr.stop();
  else release();
}

export async function startRecording() {
  if (st.active || st.starting) return;
  // o Firefox não pré-seleciona a aba: o "Permitir" só habilita depois de escolher a fonte
  if (/firefox/i.test(navigator.userAgent)) toast("Escolha a janela ou tela no menu e clique em Permitir");
  touched = Date.now();
  patch({ starting: true });
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      systemAudio: "include",
    } as DisplayMediaStreamOptions);
    streams = [screen];
    let mic: MediaStream | null = null;
    if (st.wantMic) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.push(mic);
      } catch {
        toastError("Microfone indisponível — gravando só a tela.");
      }
    }
    micTrack = mic?.getAudioTracks()[0] ?? null;

    // mistura o áudio da aba (se houver) com a voz num único trilho
    const tracks: MediaStreamTrack[] = [...screen.getVideoTracks()];
    const sources = [screen, mic].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
    if (sources.length) {
      const ac = new AudioContext();
      ctx = ac;
      const dest = ac.createMediaStreamDestination();
      sources.forEach((s) => ac.createMediaStreamSource(s).connect(dest));
      tracks.push(...dest.stream.getAudioTracks());
    }

    const mime = pickMime();
    const chunks: Blob[] = [];
    const r = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const type = r.mimeType || "video/webm";
      if (chunks.length) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(chunks, { type }));
        a.download = `gravacao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${type.includes("mp4") ? "mp4" : "webm"}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        toast("Gravação salva");
      }
      release();
    };
    // o botão "parar de compartilhar" do navegador também encerra a gravação
    screen.getVideoTracks()[0].addEventListener("ended", stopRecording);
    mr = r;
    r.start(1000);
    patch({ starting: false, active: true, hasMic: !!micTrack, startedAt: Date.now() });
  } catch (e) {
    release();
    if ((e as DOMException)?.name !== "NotAllowedError") toastError("Não foi possível iniciar a gravação.");
  }
}

export function toggleMic() {
  const next = !st.wantMic;
  if (micTrack) micTrack.enabled = next;
  patch({ wantMic: next });
}

/** salva o que já foi gravado se a aba for fechada */
window.addEventListener("pagehide", () => st.active && stopRecording());

const fmt = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  return `${h ? h + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function Elapsed() {
  const { startedAt } = useRec();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="rec-time" role="timer">
      {fmt((Date.now() - startedAt) / 1000)}
    </span>
  );
}

/** controles de gravação; `bar` = versão compacta para a barra superior do editor */
export function RecordControls({ bar }: { bar?: boolean }) {
  const r = useRec();
  const supported = !!navigator.mediaDevices?.getDisplayMedia && !!window.MediaRecorder;
  if (!supported) return null;
  return (
    <div className={`${bar ? "rec-inline" : "hud glass present-rec"}${r.active ? " on" : ""}`} role="group" aria-label="Gravação">
      {r.active && <span className="rec-dot" aria-hidden />}
      {r.active && <Elapsed />}
      {(!r.active || r.hasMic) && (
        <button className="btn ghost icon" onClick={toggleMic} aria-pressed={r.wantMic} aria-label={r.wantMic ? "Desativar microfone" : "Ativar microfone"} data-tip={r.wantMic ? "Microfone ligado" : "Microfone desligado"} data-tip-pos="bottom">
          <Glyph name={r.wantMic ? "mic" : "mic-off"} size={18} />
        </button>
      )}
      <button
        className={`btn ${bar ? "ghost" : "sm"} rec-btn${r.active ? " stop" : ""}`}
        onClick={r.active ? stopRecording : () => void startRecording()}
        disabled={r.starting}
        data-tip={r.active ? "Parar e salvar a gravação" : "Gravar tela e voz\nEscolha “Esta aba” ao compartilhar"}
        data-tip-pos="bottom"
      >
        <Glyph name={r.active ? "stop" : "record"} size={bar ? 17 : 16} /> {r.active ? "Parar" : "Gravar"}
      </button>
    </div>
  );
}
