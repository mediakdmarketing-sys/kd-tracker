# ADR-0002 — Pluggable file storage (local disk now, S3 later)

**Status:** Accepted (Sprint 3)

## Context

Screenshots and audio samples are the bulk of the data. The spec says S3. During the build we
do not want an AWS account, and CI must not need one either. But the retention rule ("delete
the *file* at 31 days, keep the row forever") has to work identically wherever files live.

## Decision

All file I/O goes through a four-method interface in `src/storage/index.js`:

```
put(key, buffer, contentType) -> { key, size }
get(key)                      -> Buffer
remove(key)                   -> void      // idempotent: missing file is not an error
exists(key)                   -> boolean
```

Two implementations:

- `local` — writes under `STORAGE_LOCAL_DIR`, sharded by `type/employeeId/YYYY-MM-DD/`.
- `s3` — same keys as S3 object keys, so the local tree and the bucket are interchangeable.

`STORAGE_DRIVER` picks one. Nothing outside `src/storage/` imports an SDK or touches `fs`.

The key format is fixed and shared by both drivers:

```
screenshots/<employeeId>/<YYYY-MM-DD>/<uuid>.jpg
audio/<employeeId>/<YYYY-MM-DD>/<uuid>.webm
```

Date-prefixed keys mean the purge job can also be expressed as an S3 lifecycle rule later,
and a mis-scoped lifecycle rule cannot reach another data type.

## Consequences

- `remove()` being idempotent is load-bearing: the purge job must be safe to re-run after a
  partial failure, and an S3 lifecycle rule may have already deleted the object.
- The purge deletes the file **first**, then nulls the URL and sets `file_deleted`. A crash
  between the two leaves an orphaned row pointing at a missing file, which the next run fixes.
  The reverse order would leave a file nobody knows about — unacceptable for a retention promise.
- Local driver is not suitable for more than one API instance. Moving to S3 is the prerequisite
  for horizontal scaling, not an optional nicety.
