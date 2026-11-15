import { describe, expect, it } from "vitest";
import { outcomeText } from "./season-outcome";
import type { SeasonOutcome } from "../types/api";

const base: SeasonOutcome = {
  status: "COMPLETED",
  planted_in_window: true,
  reached_maturity: true,
  maturity_date: "2024-09-20",
  gdd_accumulated: 1500,
  gdd_required: 1500,
  stress_days: 0,
  stress_day_ks: 0.8,
  frost_days: 0,
  data_state: "SIMULATED",
  note: "not a yield prediction",
};

describe("outcomeText", () => {
  it("states a completed cycle without stress", () => {
    expect(outcomeText(base)).toContain("completó su ciclo sin estrés hídrico relevante");
  });
  it("counts stress days and frost", () => {
    const text = outcomeText({ ...base, stress_days: 12, frost_days: 2 });
    expect(text).toContain("12 días de estrés hídrico");
    expect(text).toContain("2 días con helada");
  });
  it("explains a crop that ran out of heat", () => {
    const text = outcomeText({ ...base, status: "NOT_MATURE", reached_maturity: false, maturity_date: null, gdd_accumulated: 900 });
    expect(text).toContain("No alcanzó la madurez");
    expect(text).toContain("faltó calor acumulado");
  });
  it("says when nothing was planted", () => {
    expect(outcomeText({ ...base, status: "NOT_PLANTED", stress_days: 0 })).toContain("No hubo siembra");
  });
});
