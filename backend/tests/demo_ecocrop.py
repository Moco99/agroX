import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.engine.ecocrop_model import EcoCropEngine, RotationEngine

engine = EcoCropEngine()
recommender = RotationEngine(engine)

print("=" * 70)
print("TEST 1: CONSULTA DE ESPECIE EN ECOCROP (2,568 especies)")
print("=" * 70)
res = engine.find_crops("Phaseolus vulgaris", limit=1)[0]
print(f"Cultivo encontrado: {res['common_name']} ({res['scientificname']})")
print(f"Familia botánica:   {res['family']}")
print(f"Temperatura óptima: {res['temp_opt'][0]} a {res['temp_opt'][1]} °C")
print(f"Lluvia óptima:      {res['rain_opt_mm'][0]} a {res['rain_opt_mm'][1]} mm")
print(f"Ciclo fenológico:   {res['cycle_days'][0]} a {res['cycle_days'][1]} días")

print("\n" + "=" * 70)
print("TEST 2: ESCENARIO CLIMÁTICO NORMAL (Lluvia: 650 mm, Temp: 23 °C)")
print("=" * 70)
normal_recs = recommender.recommend_top_rotations(t_mean=23.0, rain_mm=650.0, soil_ph=6.5, t_extreme_days=2)
for idx, r in enumerate(normal_recs, 1):
    seq_str = " -> ".join(r["sequence"])
    print(f"\nRank {idx}: [{seq_str}] | Score: {r['overall_score']}/100 | Estado: {r['status']}")
    for c in r["cycles"]:
        print(
            f"   Ciclo {c['cycle']}: {c['name']:15} | Idoneidad EcoCrop: {c['ecocrop_suitability']:5.1f}%"
            f" | Riesgo ML: {c['risk_level']:8} | Factor: {c['key_risk_factor']}"
        )

print("\n" + "=" * 70)
print("TEST 3: ESCENARIO WHAT-IF: SEQUÍA MODERADA (Lluvia: 420 mm, Temp: 31 °C)")
print("=" * 70)
drought_recs = recommender.recommend_top_rotations(t_mean=31.0, rain_mm=420.0, soil_ph=6.5, t_extreme_days=10)
for idx, r in enumerate(drought_recs, 1):
    seq_str = " -> ".join(r["sequence"])
    print(f"\nRank {idx}: [{seq_str}] | Score: {r['overall_score']}/100 | Estado: {r['status']}")
    for c in r["cycles"]:
        print(
            f"   Ciclo {c['cycle']}: {c['name']:15} | Idoneidad EcoCrop: {c['ecocrop_suitability']:5.1f}%"
            f" | Riesgo ML: {c['risk_level']:8} | Factor: {c['key_risk_factor']}"
        )
