# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de GitHub: pestaña *Security* del repositorio → *Report a vulnerability*
(https://github.com/Moco99/agroX/security/advisories/new).

Incluye qué encontraste, cómo reproducirlo y qué impacto tiene. Responderemos en cuanto sea posible.

## Alcance

- Código de este repositorio (`backend/`, `frontend/`, `pipeline/`, `scraper/`).
- Si encuentras una llave, token o credencial publicada por error, repórtala por el mismo canal para revocarla.

Los servicios de terceros (NASA, ESA, ISRIC, USDA, Esri, etc.) quedan fuera de alcance: repórtalos a sus responsables.

## Secretos

El proyecto no necesita llaves para correr en local. Nunca subas `.env`, tokens ni credenciales a un commit, issue o PR.
