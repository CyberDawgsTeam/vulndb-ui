# Fetching attachments from vulndb-ui (for vulndb-client / nakon)

vulndb-ui now lets a configuration (vulnerability, misconfiguration, or
service) carry file attachments — payloads, installers, PoC binaries, etc.
— alongside its script. This doc is for whatever runs the actual
provisioning (nakon / vulndb-client): how to discover, fetch, and stage
those files.

## Network shape — why this isn't a one-step download

- vulndb-ui, the MySQL DB, and MinIO all live on the same box/network
  (`10.0.0.118`). Wherever nakon runs is assumed to be on **that** network
  too (reachable to vulndb-ui's API and directly to MinIO on port 9000) —
  that's the "quotient box" doing the deploying.
- The actual target/endpoint machines nakon provisions are on **separate
  subnets** and can't reach the DB/MinIO network at all.
- So attachments have to make two hops: MinIO → the box nakon runs on
  (download), then that box → the endpoint machine (transfer), using
  whatever transport nakon already uses to push the script over (SCP/SFTP,
  WinRM, etc.). There's no way for an endpoint machine to pull a file from
  MinIO directly — don't hand it a presigned URL and expect it to work.

## 1. Discover attachments for a configuration

`GET /api/configurations` (the same bulk endpoint nakon presumably already
calls to get scripts/dependencies) now includes an `attachments` array on
every configuration object:

```json
{
  "id": 7,
  "name": "vsftpd-anon-write",
  "category": "misconfiguration",
  "script": "...",
  "attachments": [
    {
      "id": 14,
      "configuration_id": 7,
      "original_name": "malicious.conf",
      "mime_type": "text/plain",
      "size_bytes": 482,
      "uploaded_at": "2026-06-25T05:49:58.000Z"
    }
  ]
}
```

Empty array if there are no attachments — most configurations won't have
any, this is opt-in per entry.

## 2. Download an attachment

```
GET /api/attachments/:id/download
```

This returns a `302` redirect straight to a MinIO presigned URL — it does
**not** proxy the bytes through vulndb-ui. Whatever HTTP client nakon uses
needs to follow redirects (most do by default; `curl -L`, Python
`requests` with default settings, etc. — just don't disable redirect
following).

```bash
curl -L -o ./staging/malicious.conf http://<vulndb-ui-host>:3000/api/attachments/14/download
```

Notes:
- The presigned URL is valid for **5 minutes**. If you're queuing
  downloads, re-hit the `/download` endpoint right before you need the
  file rather than caching the redirect target.
- The response carries a `Content-Disposition: attachment;
  filename="<original_name>"` header, but don't rely on your HTTP client
  to honor it for the local filename — use `original_name` from the
  `attachments` array instead, and the attachment `id` if you need to
  disambiguate (two attachments on the same configuration could in theory
  share a name).
- There's no auth on this endpoint or on the presigned URL beyond it being
  time-limited and scoped to one object — treat the URL itself as a
  short-lived credential (don't log it, don't pass it on to anything
  outside this one download).

## 3. Recommended flow when provisioning a configuration

For each configuration being deployed that has a non-empty `attachments`
array:

1. Download each attachment to a local staging directory on the box nakon
   runs on (keyed by attachment `id` to avoid name collisions, e.g.
   `staging/<configuration_id>/<id>-<original_name>`).
2. After staging, transfer the file(s) to the target endpoint machine
   using the same transport already used to push the script over, placing
   them wherever the script expects to find them (e.g. its own working
   directory, or a path supplied via a `depends_on` var / environment
   variable convention you already have).
3. The script itself is responsible for referencing the file by whatever
   relative/absolute path it ends up at on the endpoint — vulndb-ui has no
   opinion on that, it just stores the bytes and the original filename.

## Cleanup

Attachments are deleted along with their configuration server-side
(MinIO object + metadata row), so nakon doesn't need to do anything to
clean up the source — only clean up whatever copies it staged locally or
pushed to the endpoint, per its own conventions.
