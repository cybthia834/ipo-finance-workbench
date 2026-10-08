import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import models as m
from .api import auth, issues, projects, reports, workflow
from .common import DomainError, audit, trace_context
from .config import settings
from .db import SessionLocal

app = FastAPI(title='财务资料与整改工作台', version='0.1.0',
    docs_url=None if settings.app_env == 'production' else '/docs',
    redoc_url=None,
    openapi_url=None if settings.app_env == 'production' else '/openapi.json')
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts.split(','))


def failure(request, code, message, status):
    return JSONResponse({'error': {'code': code, 'message': message}, 'trace_id': getattr(request.state, 'trace_id', '')}, status_code=status)


@app.middleware('http')
async def boundary(request: Request, call_next):
    request.state.trace_id = m.uid(); started = time.monotonic()
    trace_context.set(request.state.trace_id)
    if request.url.path.startswith(('/api/v1/ai/', '/api/v1/evidence/uploads', '/api/v1/evidence/files/', '/api/v1/files/')):
        try:
            with SessionLocal.begin() as db:
                audit(db, None, 'disabled_feature', 'feature_denied', result='denied', trace=request.state.trace_id)
        except SQLAlchemyError:
            return failure(request, 'AUDIT_UNAVAILABLE', '必要审计不可用', 503)
        return failure(request, 'FEATURE_DISABLED', '第一阶段仅开放目录登记，原件上传与AI未启用', 403)
    size = request.headers.get('content-length', '0')
    if not size.isdigit() or int(size) > 128 * 1024:
        return failure(request, 'BODY_TOO_LARGE', '请求超出目录操作允许大小', 413)
    # Count the actual stream as well; chunked transfer has no Content-Length.
    if request.method in ('POST', 'PUT', 'PATCH'):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 128 * 1024:
                return failure(request, 'BODY_TOO_LARGE', '请求超出目录操作允许大小', 413)
        request._body = bytes(body)
    response = await call_next(request)
    response.headers.update({'X-Trace-ID': request.state.trace_id, 'Cache-Control': 'no-store',
                             'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin'})
    logging.info('request trace_id=%s status=%s elapsed_ms=%d', request.state.trace_id, response.status_code, (time.monotonic() - started) * 1000)
    return response


@app.exception_handler(DomainError)
async def domain_error(request: Request, exc: DomainError):
    try:
        with SessionLocal.begin() as db:
            actor = db.get(m.User, request.state.actor_id) if hasattr(request.state, 'actor_id') else None
            audit(db, actor, 'request', exc.code, result='denied', trace=request.state.trace_id)
    except SQLAlchemyError:
        return failure(request, 'AUDIT_UNAVAILABLE', '必要审计服务不可用，操作未提交', 503)
    return failure(request, exc.code, exc.message, exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc):
    return failure(request, 'VALIDATION_FAILED', '输入字段不完整或格式不符合要求，请检查后重试', 422)


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return failure(request, 'CONSTRAINT_CONFLICT', '记录重复、引用无效或状态约束冲突', 409)


@app.exception_handler(SQLAlchemyError)
async def db_error(request, exc):
    logging.error('database_failure trace_id=%s error_type=%s', request.state.trace_id, type(exc).__name__)
    return failure(request, 'STORAGE_UNAVAILABLE', '必要存储或审计不可用，操作未提交', 503)


@app.exception_handler(Exception)
async def unexpected(request, exc):
    logging.error('unexpected trace_id=%s error_type=%s', request.state.trace_id, type(exc).__name__)
    return failure(request, 'INTERNAL_ERROR', '操作暂时失败，请通过追踪号联系管理员', 500)


@app.get('/api/v1/health/live')
def live():
    return {'status': 'alive'}


@app.get('/api/v1/health/ready')
def ready():
    with SessionLocal() as db:
        db.execute(text('SELECT version_num FROM alembic_version'))
        db.execute(text('SELECT id FROM audit_event LIMIT 1'))
    return {'status': 'ready', 'mode': 'directory_only'}


for router in (auth.router, projects.router, workflow.router, issues.router, reports.router):
    app.include_router(router, prefix='/api/v1')
