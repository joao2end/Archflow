import { useEffect, useState } from "react";
import { Canvas } from "./ui/Canvas";
import { IsoGate } from "./ui/iso";
import { Modals } from "./ui/modals";
import { FilesPanel } from "./ui/files";
import { Dock, Inspector, Library, Toast, TopBar, ZoomBar } from "./ui/panels";
import { useHotkeys } from "./ui/keys";
import { EmptyHint } from "./ui/emptyhint";
import { Minimap } from "./ui/minimap";
import { ModeTools } from "./ui/domain";
import { DrawBar } from "./ui/drawbar";
import { PresentMode } from "./ui/present";
import { PlayPanel } from "./ui/logic";
import { LessonPanel } from "./ui/lessons";
import { LogicTour } from "./ui/logictour";
import { TerminalPanel } from "./ui/terminal";
import { AgentRunPanel } from "./ui/agentrun";
import type { TermApi } from "./ui/workflow";
import { startSync, useStore } from "./ui/store";

export default function App() {
  const panel = useStore((s) => s.panel);
  const present = useStore((s) => s.present);
  // reproduzindo um cenário, o inspetor sai de cena: a tela fica para o caminho e o painel da reprodução
  const playing = useStore((s) => !!s.play);
  const agentsMode = useStore((s) => s.doc.mode === "agents");
  const [term, setTerm] = useState<TermApi>();
  useHotkeys();
  useEffect(() => {
    startSync();
  }, []);
  return (
    <>
      <div className="backdrop" aria-hidden />
      <Canvas />
      <IsoGate />
      {present ? (
        <PresentMode />
      ) : (
        <>
          <TopBar />
          <Dock />
          {panel === "assets" && <Library />}
          {panel === "files" && <FilesPanel />}
          {!playing && <Inspector />}
          <ZoomBar />
          <div className="hud corner-br">
            <ModeTools />
            <Minimap />
          </div>
          <EmptyHint />
          <DrawBar />
          <LessonPanel />
        </>
      )}
      <PlayPanel />
      <LogicTour />
      {agentsMode && !present && <AgentRunPanel term={term} />}
      {agentsMode && !present && <TerminalPanel onApi={setTerm} />}
      <Toast />
      <Modals />
    </>
  );
}
