import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClimateResponse } from "../../types/api";
import { ClimateView } from "./climate-screen";

const m = (value: number | null, unit: string) => ({ value, unit, data_state: "ESTIMATED", source: "src" });
const data = {
  methodology: "FAO-56",
  data_mode: "live",
  series: { days: [], provenance: { source: "NASA POWER", data_state: "MEASURED" }, warnings: ["aviso de serie"] },
  indicators: {
    precip_total: m(120, "mm"), t_mean: m(18, "C"), gdd_total: m(900, "C-day"), et0_total: m(300, "mm"),
    frost_days: m(2, "days"), hot_days: m(1, "days"), precip_anomaly_pct: m(null, "%"), spi: m(-1.3, "index"),
  },
  warnings: ["aviso global"],
} as unknown as ClimateResponse;

describe("ClimateView", () => {
  it("shows indicators, plain-language SPI, source, state and warnings", () => {
    const html = renderToStaticMarkup(<ClimateView data={data} />);
    expect(html).toContain("Lluvia acumulada");
    expect(html).toContain("Días de helada");
    expect(html).toContain("moderadamente seco");
    expect(html).toContain("al menos 10 años");
    expect(html).toContain("NASA POWER");
    expect(html).toContain("Estimado");
    expect(html).toContain("aviso de serie");
    expect(html).toContain("aviso global");
  });
});
