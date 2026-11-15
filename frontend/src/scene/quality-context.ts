import { createContext, useContext } from "react";
import { qualitySettings, type QualitySettings } from "../lib/scene-quality";

// ─────────────────────────────────────────
// Section: Quality settings shared by every scene component
// ─────────────────────────────────────────

export const QualityContext = createContext<QualitySettings>(qualitySettings("medium"));

export function useQuality(): QualitySettings {
  return useContext(QualityContext);
}
