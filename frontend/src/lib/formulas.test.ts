import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { es } from "../i18n/es";

// ─────────────────────────────────────────
// Section: White-box texts pinned against the engine source (ADR-005: the explanation must match the code)
// ─────────────────────────────────────────

// Local files only (no network): if the engine changes its method, this test fails and the UI text must follow
const ENGINE = resolve(__dirname, "../../../backend/app/engine");
const engine = (file: string) => readFileSync(resolve(ENGINE, file), "utf8");

describe("formula texts match the engine", () => {
  it("twin GDD uses the modified method when the crop has a cap", () => {
    const src = engine("phenology.py");
    expect(src).toContain("t_max = min(t_max, t_cap)");
    expect(src).toContain("t_min = max(t_min, t_base)");
    const f = es.formulas.gddTwin;
    expect(f.formula).toContain("mín(Tmáx, T tope)");
    expect(f.formula).toContain("máx(Tmín, T base)");
    expect(f.steps.join(" ")).toContain("promedio simple");
  });

  it("climate-panel GDD is the plain average without caps", () => {
    const src = engine("indicators.py");
    expect(src).toMatch(/max\(0\.0, \(d\.t_max \+ d\.t_min\) \/ 2 - gdd_base_c\)/);
    expect(es.formulas.gddClimate.formula).toBe("GDD diario = máx(0, (Tmáx + Tmín) ÷ 2 − T base)");
    expect(es.formulas.gddClimate.limits).toContain("sin temperatura tope");
  });

  it("the water balance subtracts the stress-adjusted ETc (Ks × Kc × ET0)", () => {
    const src = engine("water_balance.py");
    expect(src).toContain("etc = kc * et0_mm");
    expect(src).toMatch(/etc_adj = min\(ks \* etc,/);
    expect(src).toContain("new_depletion = depletion - effective - irrigation + etc_adj");
    expect(es.formulas.waterBalance.formula).toContain("Ks × Kc × ET0");
    expect(es.formulas.waterBalance.steps.join(" ")).toContain("Ks × Kc × ET0");
  });

  it("the SPI minimum history in the text matches the engine", () => {
    const min = engine("spi.py").match(/MIN_YEARS = (\d+)/)?.[1];
    expect(min).toBeDefined();
    expect(es.formulas.spi.limits).toContain(`${min} años`);
  });
});
