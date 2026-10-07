import csv
import io
import logging
import time
import zipfile
from datetime import timedelta

from sqlalchemy import select

from . import models as m
from .api.reports import snapshot_access
from .common import DomainError, audit, canonical, digest, lock_project, require
from .config import settings
from .db import SessionLocal
from .security import membership
from .services import generate


def safe_cell(value):
    value = '' if value is None else str(value)
    if value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r', '\n')):
        return "'" + value
    return value


def make_export(db, actor, approval_id):
    a = db.get(m.Approval, approval_id)
    require(a and a.state == 'approved', 'EXPORT_UNAPPROVED', '导出尚未获批')
    snap = snapshot_access(db, actor, db.get(m.Snapshot, a.snapshot_id))
    require(a.payload['manifest_hash'] == snap.manifest_hash, 'MANIFEST_MISMATCH', '快照校验失败')
    old = db.scalar(select(m.Export).where(m.Export.approval_id == a.id))
    if old: return {'export_id': old.id}
    content = io.StringIO(newline=''); writer = csv.writer(content, lineterminator='\n')
    writer.writerow(['目录代号', '主体编号', '期间编号', '版本', '保管部门', '位置代号', '取得状态'])
    for e in snap.manifest['evidence']:
        v = e['version']; meta = v['content']
        writer.writerow([safe_cell(x) for x in [e['code'], e['org_id'], e['period_id'], v['number'], meta['department'], meta['location_code'], meta['acquisition']]])
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, raw in [('directory.csv', ('\ufeff' + content.getvalue()).encode()),
                          ('manifest.json', canonical(snap.manifest).encode())]:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    blob = output.getvalue(); root = settings.export_storage_root
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / f'{a.id}.zip'; temp = root / f'{a.id}.tmp'
    temp.write_bytes(blob); temp.chmod(0o600); temp.replace(path)
    row = m.Export(approval_id=a.id, snapshot_id=snap.id, path=str(path.resolve()), artifact_hash=digest(blob),
                   expires_at=m.now() + timedelta(hours=settings.export_ttl_hours))
    db.add(row); db.flush(); audit(db, actor, row.id, 'export_generated', a.project_id)
    return {'export_id': row.id}


def process_one():
    with SessionLocal.begin() as db:
        job = db.scalar(select(m.Job).where(m.Job.state == 'queued').order_by(m.Job.created_at).with_for_update(skip_locked=True).limit(1))
        if not job: return False
        lock_project(db, job.project_id)
        actor = db.get(m.User, job.actor_id)
        try:
            with db.begin_nested():
                require(actor and actor.active, 'ACTOR_DISABLED', '任务发起人已停用')
                membership(db, actor, job.project_id, ['cfo', 'pmo'])
                result = generate(db, actor, job.project_id, job.payload) if job.kind == 'generate' else make_export(db, actor, job.payload['approval_id'])
                audit(db, actor, job.id, 'job_completed', job.project_id)
            job.result, job.state = result, 'succeeded'
        except DomainError as exc:
            job.state, job.error_code = 'failed', exc.code
            audit(db, actor, job.id, 'job_denied', job.project_id, result='denied')
        job.attempts += 1
    return True


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            if not process_one(): time.sleep(1)
        except Exception as exc:
            # Transaction rolls back, leaving the job queued and claimable after restart.
            logging.error('worker_retry error_type=%s', type(exc).__name__)
            time.sleep(3)
