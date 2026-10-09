import { useEffect } from "react";
import { Canvas } from "./ui/Canvas";
import { Modals } from "./ui/modals";
import { FilesPanel } from "./ui/files";
import { ConnBar, Dock, Inspector, Library, Toast, TopBar, ZoomBar } from "./ui/panels";
import { useHotkeys } from "./ui/keys";
import { startSync, useStore } from "./ui/store";

export default function App() {
  const panel = useStore((s) => s.panel);
  useHotkeys();
  useEffect(() => {
    startSync();
  }, []);
  return (
    <>
      <div className="backdrop" aria-hidden />
      <Canvas />
      <TopBar />
      <Dock />
      {panel === "assets" && <Library />}
      {panel === "files" && <FilesPanel />}
      <Inspector />
      <ZoomBar />
      <ConnBar />
      <Toast />
      <Modals />
    </>
  );
}
