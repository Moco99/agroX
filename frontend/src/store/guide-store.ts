import { create } from "zustand";

// ─────────────────────────────────────────
// Section: Quick guide / glossary panel visibility (opened from the top bar or any model note)
// ─────────────────────────────────────────

interface GuideState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useGuideStore = create<GuideState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
