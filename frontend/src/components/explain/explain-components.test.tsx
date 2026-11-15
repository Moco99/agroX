import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideContent } from "../../app-shell/guide-panel";
import { es } from "../../i18n/es";
import { DataStateLegend } from "./data-state-legend";
import { ExplainedMetric } from "./explained-metric";
import { HowCalculated } from "./how-calculated";
import { ModelNote } from "./model-note";
import { ReadingChip } from "./reading-chip";
import { Term } from "./term";

describe("interpretability components", () => {
  it("renders a glossary tooltip with the definition linked for screen readers", () => {
    const html = renderToStaticMarkup(<Term id="ndvi" />);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("aria-describedby");
    expect(html).toContain("suelo desnudo");
  });

  it("never relies on colour alone for a reading", () => {
    const html = renderToStaticMarkup(<ReadingChip reading={{ tone: "bad", label: "insuficiente" }} />);
    expect(html).toContain("insuficiente");
    expect(html).toContain("Problema");
    expect(html).toContain("✕");
  });

  it("shows the white-box formula, inputs and limits", () => {
    const html = renderToStaticMarkup(<HowCalculated id="waterBalance" current="(200 − 76) ÷ 200 = 62 %" />);
    expect(html).toContain("¿Cómo se calcula?");
    expect(html).toContain("FAO-56");
    expect(html).toContain("TAW");
    expect(html).toContain("62 %");
    expect(html).toContain("Límites");
  });

  it("explains a KPI: value, spelled unit, verdict, meaning and provenance", () => {
    const html = renderToStaticMarkup(
      <ExplainedMetric
        label="Agua disponible"
        value="62"
        unit="%"
        unitLong={es.units.pctTaw}
        state="ESTIMATED"
        reading={{ tone: "good", label: "suficiente" }}
        meaning={es.meaning.soilWater}
        how="waterBalance"
      />,
    );
    expect(html).toContain("Agua disponible");
    expect(html).toContain("suficiente");
    expect(html).toContain("% del agua útil del suelo (TAW)");
    expect(html).toContain("Estimado");
    expect(html).toContain("tone-good");
  });

  it("explains every data_state in the legend", () => {
    const html = renderToStaticMarkup(<DataStateLegend open />);
    for (const s of ["Medido", "Declarado", "Estimado", "Simulado", "Sintético"]) expect(html).toContain(s);
    expect(html).toContain("No representa la parcela real");
  });

  it("states the transparent-model and comparative-index rules", () => {
    const html = renderToStaticMarkup(<ModelNote />);
    expect(html).toContain("no caja negra");
    expect(html).toContain("no probabilidades ni predicciones de rendimiento");
  });

  it("renders the quick guide with steps, colours, data states and the full glossary", () => {
    const html = renderToStaticMarkup(<GuideContent />);
    expect(html).toContain(es.guide.stepsTitle);
    expect(html).toContain(es.guide.colorsTitle);
    expect(html).toContain(es.dataStateTitle);
    for (const entry of Object.values(es.glossary)) expect(html).toContain(entry.term);
  });

  it("keeps every glossary entry and formula filled in plain words", () => {
    for (const entry of Object.values(es.glossary)) expect(entry.text.length).toBeGreaterThan(30);
    for (const f of Object.values(es.formulas)) {
      expect(f.steps.length).toBeGreaterThan(0);
      expect(f.formula).not.toBe("");
      expect(f.limits).not.toBe("");
    }
  });
});
