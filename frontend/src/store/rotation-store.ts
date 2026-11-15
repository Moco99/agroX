import { create } from "zustand";

interface RotationViewState {
  active: boolean;
  open: () => void;
  close: () => void;
}

export const useRotationView = create<RotationViewState>((set) => ({
  active: false,
  open: () => set({ active: true }),
  close: () => set({ active: false }),
}));
