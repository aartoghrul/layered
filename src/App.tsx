import { useRef } from "react";
import { isDoc } from "./model/doc";
import { Renderer } from "./renderer/Renderer";
import { useStore } from "./store";

export function App() {
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
        </div>
      </header>
      <main className="main">
        <Renderer />
      </main>
    </div>
  );
}
