import hashlib
import json
from contextvars import ContextVar
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session as DBSession

from . import models as m
from .db import get_db

DB = Annotated[DBSession, Depends(get_db, scope='function')]
trace_context = ContextVar('request_trace', default=None)


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 403):
        self.code, self.message, self.status = code, message, status


def require(ok, code='FORBIDDEN', message='当前操作不被允许', status=403):
    if not ok:
        raise DomainError(code, message, status)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), default=str)


def digest(value):
    if isinstance(value, bytes):
        return hashlib.sha256(value).hexdigest()
    if not isinstance(value, str):
        value = canonical(value)
    return hashlib.sha256(value.encode()).hexdigest()


def record(row, exclude=()):
    result = {}
    for c in row.__table__.columns:
        if c.name in exclude:
            continue
        val = getattr(row, c.key)
        if isinstance(val, datetime):
            result[c.name] = val.astimezone(timezone.utc).isoformat()
        else:
            result[c.name] = val.isoformat() if isinstance(val, date) else val
    return result


def user_info(user):
    return record(user, ('password_hash', 'failed_logins', 'locked_until'))


def audit(db, actor, object_id, action, project_id=None, result='success', before=None, after=None, trace=None):
    db.add(m.AuditEvent(actor_id=actor.id if actor else None, object_id=str(object_id),
                       action=action, project_id=project_id, result=result,
                       trace_id=trace or trace_context.get() or m.uid(), before_hash=digest(before) if before is not None else None,
                       after_hash=digest(after) if after is not None else None))
    db.flush()  # Fail closed before a successful response can be built.


def lock_project(db, project_id):
    # One transaction per project; appropriate for <= 10 users. All business
    # commands and workers use this same lock, including snapshot freezing.
    db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': project_id})


def check_version(row, expected):
    require(row.row_version == expected, 'VERSION_CONFLICT', '记录已更新，请刷新后比较差异', 409)


def bump(row):
    row.row_version += 1


def command(db, actor, request: Request, payload, fn):
    key = request.headers.get('Idempotency-Key')
    require(key and len(key) <= 100, 'IDEMPOTENCY_REQUIRED', '此操作需要有效的幂等键', 422)
    path = request.url.path
    db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'),
               {'key': f'{actor.id}:{path}:{key}'})
    old = db.scalar(select(m.Idempotency).where(m.Idempotency.actor_id == actor.id,
                                               m.Idempotency.path == path, m.Idempotency.key == key))
    h = digest(payload)
    if old:
        require(old.request_hash == h, 'IDEMPOTENCY_CONFLICT', '相同请求键对应不同内容', 409)
        # Callers MUST validate current authorization before entering command.
        return old.result
    value = fn()
    db.flush()
    value = json.loads(canonical(value))
    db.add(m.Idempotency(actor_id=actor.id, path=path, key=key, request_hash=h, result=value))
    db.flush()
    return value


def ok(data):
    return {'data': data, 'as_of': m.now().isoformat()}
