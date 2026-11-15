import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/global.css";

const root = document.getElementById("root");
if (root) {
  // No StrictMode: its dev double-mount makes drei <Html> unmount its own React root mid-render (React 19 warning)
  createRoot(root).render(<App />);
}
