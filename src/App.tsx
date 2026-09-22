import { useRef, useState } from "react";
import { isDoc } from "./model/doc";
import { DepthTree } from "./editor/DepthTree";
import { Renderer } from "./renderer/Renderer";
import { useStore } from "./store";

export function App() {
  const version = useStore((s) => s.version);
  const [split, setSplit] = useState(0.46);
  const [readerOnly, setReaderOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportDoc = () => {
    const blob = new Blob([JSON.stringify(useStore.getState().doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "layered.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importDoc = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!isDoc(parsed)) throw new Error("not a Layered document");
      useStore.getState().replaceDoc(parsed);
    } catch (err) {
      alert(`Could not import: ${(err as Error).message}`);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setSplit(Math.min(0.75, Math.max(0.2, ev.clientX / window.innerWidth)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Layered</div>
        <div className="actions">
          <button onClick={exportDoc}>Export</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              importDoc(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button onClick={() => confirm("Replace the document with the sample?") && useStore.getState().resetSample()}>
            Reset sample
          </button>
          <button className={readerOnly ? "on" : ""} onClick={() => setReaderOnly((r) => !r)}>
            Reader only
          </button>
        </div>
      </header>
      <main className="panes">
        {!readerOnly && (
          <>
            <section className="pane editor-pane" style={{ width: `${split * 100}%` }}>
              <DepthTree key={version} />
            </section>
            <div className="divider" onPointerDown={startDrag} />
          </>
        )}
        <section className="pane reader-pane">
          <Renderer />
        </section>
      </main>
    </div>
  );
}
