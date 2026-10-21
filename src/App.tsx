import { useEffect, useState } from "react";
import { Canvas } from "./ui/Canvas";
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
import { TerminalPanel } from "./ui/terminal";
import { AgentRunPanel } from "./ui/agentrun";
import type { TermApi } from "./ui/workflow";
import { startSync, useStore } from "./ui/store";

export default function App() {
  const panel = useStore((s) => s.panel);
  const present = useStore((s) => s.present);
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
      {present ? (
        <PresentMode />
      ) : (
        <>
          <TopBar />
          <Dock />
          {panel === "assets" && <Library />}
          {panel === "files" && <FilesPanel />}
          <Inspector />
          <ZoomBar />
          <div className="hud corner-br">
            <ModeTools />
            <Minimap />
          </div>
          <EmptyHint />
          <DrawBar />
        </>
      )}
      <PlayPanel />
      {agentsMode && !present && <AgentRunPanel term={term} />}
      {agentsMode && !present && <TerminalPanel onApi={setTerm} />}
      <Toast />
      <Modals />
    </>
  );
}
