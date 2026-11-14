# Almacenamiento S3

> TL;DR: Un bucket privado con `raw/` (inmutable) y `derived/` (pequeño). La app y la demo no leen raw/ ni dependen de red. IAM de mínimo privilegio. Nombres reales fuera del repo.
> Depende de: [data-pipeline](../02-modules/data-pipeline.md)
> Estado: draft
> Última revisión: 2026-11-14

Decisión: ADR-006 en [decisions](../00-overview/decisions.md).

## Layout

```
s3://<AGROX_BUCKET>/
  raw/<source>/...            # copia 1:1 de data/raw/<source>/, inmutable
  raw/manifest.csv            # manifest del scraper (source,url,path,sha256,bytes,fetched_at)
  derived/<version>/weather/  # salidas de pipeline/ (MB)
  derived/<version>/soil/
  derived/<version>/obs/
  derived/<version>/parcel/
  derived/<version>/catalog/
  derived/<version>/MANIFEST.json   # lista de archivos + sha256 + insumos raw
```
`<version>` = `v1`, `v2`… (no sobrescribir una versión publicada).

## Reglas

| Regla | Detalle |
|---|---|
| Privado | Block Public Access activado; sin URLs públicas. |
| raw inmutable | Solo se agregan objetos; nunca se reemplazan ni borran (los usuarios no tienen permiso de borrar). |
| derived pequeño | Lo que consume la app; objetivo: pocos MB. |
| Demo offline | La demo empaqueta `derived/<version>/` en `backend/app/data/`; sin red en runtime. |
| Integridad | Verificar sha256 contra manifest tras descargar. |
| Secretos | Llaves en `.env` / variables de entorno; `.env` está en `.gitignore`. Jamás en git, issues, PRs ni docs. |
| Repo público | Nunca escribir el nombre real del bucket, ARNs ni IDs de cuenta; usar placeholders `<AGROX_BUCKET>`, `<AWS_ACCOUNT_ID>`. |

## Variables de entorno (nombres; valores fuera del repo)

```
AGROX_S3_BUCKET=<AGROX_BUCKET>
AGROX_S3_REGION=<region>
AWS_ACCESS_KEY_ID=<from IAM user, local only>
AWS_SECRET_ACCESS_KEY=<from IAM user, local only>
AGROX_DERIVED_VERSION=v1
```

## IAM (mínimo privilegio)

Un usuario o rol por persona/uso; solo `s3:ListBucket` sobre el bucket y `s3:GetObject`/`s3:PutObject` sobre sus prefijos. Sin `s3:DeleteObject`, sin otros servicios.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::<AGROX_BUCKET>"},
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
     "Resource": ["arn:aws:s3:::<AGROX_BUCKET>/raw/*", "arn:aws:s3:::<AGROX_BUCKET>/derived/*"]}
  ]
}
```
Variante de solo lectura (backend en build/CI): solo `ListBucket` + `GetObject` sobre `derived/*`.
Nota: `PutObject` permite sobrescribir una clave existente; la inmutabilidad de `raw/` se refuerza con versionado del bucket u Object Lock (decisión de configuración del dueño, no verificada aquí).

## Comandos de referencia (AWS CLI)

```bash
# Upload raw data once (owner of the 30 GB copy); --size-only skips files already uploaded
aws s3 sync data/raw "s3://$AGROX_S3_BUCKET/raw" --size-only
# Fetch only the small derived set for local development and the demo
aws s3 sync "s3://$AGROX_S3_BUCKET/derived/$AGROX_DERIVED_VERSION" backend/app/data
```

Costos: no se documentan aquí (no verificados); consultar la página oficial de precios.
