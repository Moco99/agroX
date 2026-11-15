# AGROX virtual twin — one-command local setup and run.
#   make setup   -> Python venv (uv) + frontend deps (pnpm) + derived data (only if missing)
#   make dev     -> backend :8000 + frontend :5173, Ctrl+C stops both
#   make dev-live -> same, with AGROX_DATA_MODE=live (any parcel)
# Other targets: derived (force rebuild from data/raw), test, lint, build, clean.

SHELL := /bin/bash
UV ?= $(shell command -v uv 2>/dev/null || echo $(HOME)/.local/bin/uv)
PNPM ?= $(shell command -v pnpm 2>/dev/null || echo pnpm)
PY := backend/.venv/bin/python

# Optional local settings (AWS_PROFILE, AGROX_S3_BUCKET, ...): absent .env must not break any target
-include .env
# Only variables that .env (or the caller) really defines are exported: an empty AWS_PROFILE would confuse boto3
$(foreach v,AWS_PROFILE AGROX_S3_BUCKET AWS_REGION AGROX_DATA_SOURCE AGROX_DATA_MODE AGROX_CACHE_DIR AGROX_CACHE_MAX_MB AGROX_RAW_DIR,$(if $(filter undefined,$(origin $(v))),,$(eval export $(v))))
DERIVED_MANIFEST := backend/app/data/derived/manifest.json

.PHONY: setup backend-deps frontend-deps derived derived-if-missing dev dev-live test lint build clean

setup: backend-deps frontend-deps derived-if-missing
	@echo "setup ok -> run: make dev"

backend-deps:
	@test -x "$(UV)" || { echo "uv not found: install it from https://docs.astral.sh/uv/"; exit 1; }
	cd backend && "$(UV)" sync --frozen

frontend-deps:
	@command -v "$(PNPM)" >/dev/null || { echo "pnpm not found: corepack enable && corepack prepare pnpm@10 --activate"; exit 1; }
	cd frontend && "$(PNPM)" install --frozen-lockfile

# derived/ is versioned, so a fresh clone runs without data/raw; rebuild only when it is missing
derived-if-missing:
	@if [ -f "$(DERIVED_MANIFEST)" ]; then \
		echo "derived/ present (make derived to rebuild from data/raw)"; \
	elif [ -d data/raw ]; then \
		$(PY) -m pipeline.build_all; \
	else \
		echo "WARNING: no derived/ and no data/raw -> backend will serve SYNTHETIC data"; \
	fi

derived:
	$(PY) -m pipeline.build_all

dev:
	@bash scripts/dev.sh

# Live mode: any parcel (pt_<lat>_<lon>) via NASA POWER/SoilGrids/etc., needs network
dev-live:
	@AGROX_DATA_MODE=live bash scripts/dev.sh

test:
	cd backend && .venv/bin/python -m pytest -q -p no:warnings
	cd frontend && "$(PNPM)" exec vitest run

lint:
	cd backend && .venv/bin/ruff check app tests ../pipeline && .venv/bin/mypy app
	cd frontend && "$(PNPM)" exec tsc --noEmit

build:
	cd frontend && "$(PNPM)" build

clean:
	rm -rf backend/.venv frontend/node_modules frontend/dist backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
