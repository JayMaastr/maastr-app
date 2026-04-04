# Snapshot: stable-2026-04-04-1837UTC

Taken: Saturday April 4, 2026 at 18:37 UTC

## Purpose
Coordinated save state across all 5 layers. To restore maastr.io to exactly
this moment, follow the rollback instructions for each layer below.

---

## Layer 1: Code (GitHub)

**Tag:** `stable-2026-04-04-1837UTC`

To redeploy Vercel from this tag:
1. Go to Vercel → Settings → Git → deploy from tag `stable-2026-04-04-1837UTC`

---

## Layer 2: Frontend (Vercel)

**Deployment ID:** `B1wsaGcJM`
**Commit:** `100eaec` — refactor: submitRevisions delegates to startRevisionUploads

To roll back:
1. Go to Vercel → Deployments
2. Find `B1wsaGcJM`
3. Click `...` → Promote to Production (instant, no rebuild)

---

## Layer 3: Mastering Service (Cloud Run)

**Active revision:** `maastr-mastering-00012-ltn`
**Region:** us-central1
**Config:** concurrency=1, min=1, max=10, no-cpu-throttling, 2Gi, 2 CPU

To roll back:
```
gcloud run services update-traffic maastr-mastering --to-revisions maastr-mastering-00012-ltn=100 --region us-central1 --project maastr-vibedev
```

---

## Layer 4: Encoder Service (Cloud Run)

**Active revision:** `maastr-encoder-00010-vsb`
**Region:** us-central1
**Config:** concurrency=1, min=1, max=20, 1Gi, 2 CPU

To roll back:
```
gcloud run services update-traffic maastr-encoder --to-revisions maastr-encoder-00010-vsb=100 --region us-central1 --project maastr-vibedev
```

---

## Layer 5: Database (Supabase)

**Project ref:** `btgednpwlkimgjwcopru`

To take the SQL dump right now (run once from terminal):
```
supabase db dump --project-ref btgednpwlkimgjwcopru > snapshots/2026-04-04-1837UTC.sql
```
Then commit that file to this same folder.

To restore from a dump:
1. In Supabase dashboard → SQL Editor
2. Run the contents of the .sql file
> Warning: this overwrites current data. Only do this intentionally.

---

## Layer 6: Audio Files (GCS)

**Bucket:** `maastr-vibedev-audio` / **Project:** `maastr-vibedev`

No rollback needed. Files are append-only — never overwritten by the pipeline.
Restoring Supabase to this snapshot still gives valid GCS URLs for all audio.

---

## Full Rollback Order

1. Restore Supabase from the .sql dump (~1 min)
2. Promote Vercel deployment `B1wsaGcJM` to production (instant)
3. Roll back mastering Cloud Run revision (instant)
4. Roll back encoder Cloud Run revision (instant)
5. GCS — no action needed

All layers are now 1:1 with this timestamp.
