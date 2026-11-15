"""Pure, deterministic twin engine: no I/O, no network, no clock, no global randomness.

Allowed imports: stdlib, numpy, app.schemas. A test enforces that nothing from
fastapi/providers/services ever leaks in here.
"""
