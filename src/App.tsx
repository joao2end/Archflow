import { useEffect } from "react";
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
import { startSync, useStore } from "./ui/store";

export default function App() {
  const panel = useStore((s) => s.panel);
  const present = useStore((s) => s.present);
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
      <Toast />
      <Modals />
    </>
  );
}
