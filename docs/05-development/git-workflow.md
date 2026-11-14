# Git workflow

> TL;DR: Una feature = una rama desde main = un worktree = un agente. PR a main solo tras revisión de otro agente. Nunca commits directos a main. Conventional Commits.
> Depende de: nada.
> Estado: draft
> Última revisión: 2026-11-14

## Ramas

| Rama | Uso |
|---|---|
| `main` | Integración. Ya incluye `scraper/` (PR #2). **Prohibido commitear directo.** |
| `docs` | Esta documentación. Cambios de docs que no van con una feature. |
| `feat/<modulo>-<descripcion-corta>` | Una feature. Ej.: `feat/twin-water-balance`, `feat/farm3d-crop-field`. |
| `fix/<modulo>-<descripcion>` | Corrección. |
| `chore/<descripcion>` | Tooling, CI, deps. |

`<modulo>` usa los IDs de [glossary](../00-overview/glossary.md) (`twin`, `earth-scanner`, `farm3d`, `rotation`, `what-if`, `copilot`, `catalog`, `pipeline`, `api`, `web`).

## Reglas

1. Rama desde `main` actualizado: `git switch main && git pull && git switch -c feat/<...>`.
2. **Una feature = una rama = un worktree = un agente responsable.**
3. Features pequeñas: orden de ≤ ~4 h. Si crece, dividir.
4. PR a `main` solo tras revisión de un **agente revisor distinto del constructor** (nunca auto-revisión). Lógica: revisor de modelo ≥ constructor ([agent-routing](../06-agents/agent-routing.md)).
5. Si la feature cambia un contrato o un módulo: actualizar su doc en el mismo PR (o PR a `docs`) y `docs/navigation.yaml` si cambian docs.
6. Nada de secretos, `data/`, `.env`, nombres reales de bucket ni IDs de cuenta en commits.
7. Rebase sobre `main` antes de pedir revisión; squash merge.

## Worktrees

```bash
# One worktree per feature keeps parallel agents from touching each other's files
git worktree add ../agroX-twin-water-balance -b feat/twin-water-balance main
# Remove it after the PR is merged
git worktree remove ../agroX-twin-water-balance
```

## Conventional Commits

```
<type>(<scope>): <summary in imperative, English>
```
Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `ci`. Scope = módulo. Ej.: `feat(twin): add FAO-56 daily water balance step`.
Commits generados por agentes incluyen el trailer de co-autoría que indique el entorno.

## Plantilla de PR

```markdown
## What
<one paragraph>

## Why
<link to roadmap phase / ADR>

## Contract / docs impact
- [ ] No contract change  |  [ ] Contract changed → data-contracts.md updated
- [ ] navigation.yaml updated (if docs added/renamed)

## Data state
- [ ] Synthetic values labeled SYNTHETIC and banner shown where applicable

## Tests
<commands run and results>

## Builder / Reviewer
Builder: <model>  ·  Reviewer: <model, different agent>
```

## Revisión

El revisor usa la lista de [agent-playbook](../06-agents/agent-playbook.md) ("Definición de terminado") y las convenciones de [conventions](conventions.md). Desacuerdo entre revisor y constructor → decide el HEAD (Fable) y, si es arquitectónico, se registra ADR.
