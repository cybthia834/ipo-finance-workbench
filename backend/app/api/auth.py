import secrets
from datetime import timedelta

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select, update

from .. import models as m, schemas as s
from ..common import DB, audit, digest, lock_identity, lock_project, ok, require, user_info, command, check_version, bump
from ..config import settings
from ..security import Actor, DUMMY_HASH, hasher, verify_password

router = APIRouter()


@router.post('/auth/login')
def login(body: s.Login, request: Request, response: Response, db: DB):
    lock_identity(db, exclusive=True)
    require(request.headers.get('origin') == settings.app_origin, 'ORIGIN_REJECTED', '请求来源无效')
    user = db.scalar(select(m.User).where(m.User.username == body.username).with_for_update())
    good = verify_password(user.password_hash if user else DUMMY_HASH, body.password)
    if not user or not user.active or not good or (user.locked_until and user.locked_until > m.now()):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= 5:
                user.locked_until = m.now() + timedelta(minutes=15)
        audit(db, user, 'login', 'login', result='denied', trace=request.state.trace_id)
        return JSONResponse({'error': {'code': 'LOGIN_FAILED', 'message': '账号或密码错误，或账号暂时不可用'},
                             'trace_id': request.state.trace_id}, status_code=401)
    user.failed_logins, user.locked_until = 0, None
    # Rotate any existing browser session on login.
    old = request.cookies.get('finance_session')
    if old:
        db.execute(update(m.Session).where(m.Session.token_hash == digest(old)).values(revoked=True))
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    db.add(m.Session(user_id=user.id, token_hash=digest(token), csrf_hash=digest(csrf),
                     expires_at=m.now() + timedelta(hours=settings.session_max_hours)))
    audit(db, user, user.id, 'login', trace=request.state.trace_id)
    response.set_cookie('finance_session', token, httponly=True, secure=settings.app_env == 'production',
                        samesite='strict', path='/', max_age=settings.session_max_hours * 3600)
    return ok({'user': user_info(user), 'csrf_token': csrf})


@router.get('/me')
def me(actor: Actor, db: DB):
    memberships = db.scalars(select(m.Membership).where(m.Membership.user_id == actor.id, m.Membership.active.is_(True))).all()
    projects = db.scalars(select(m.Project).where(m.Project.id.in_([x.project_id for x in memberships]))).all()
    return ok({'user': user_info(actor), 'projects': [{'id': p.id, 'name': p.name, 'demo': p.demo} for p in projects],
               'memberships': [{'project_id': x.project_id, 'roles': x.roles, 'org_ids': x.org_ids} for x in memberships],
               'demo_mode': settings.demo_mode})


@router.post('/auth/logout')
def logout(request: Request, response: Response, actor: Actor, db: DB):
    request.state.session.revoked = True
    audit(db, actor, actor.id, 'logout')
    response.delete_cookie('finance_session', path='/')
    return ok({'logged_out': True})


@router.post('/auth/password')
def change_password(body: s.PasswordChange, actor: Actor, db: DB, response: Response):
    require(verify_password(actor.password_hash, body.current_password), 'INVALID_PASSWORD', '当前密码无效')
    actor.password_hash, actor.must_change_password = hasher.hash(body.new_password), False
    db.execute(update(m.Session).where(m.Session.user_id == actor.id).values(revoked=True))
    audit(db, actor, actor.id, 'password_changed')
    response.delete_cookie('finance_session', path='/')
    return ok({'login_required': True})


@router.post('/users')
def create_user(body: s.UserCreate, request: Request, actor: Actor, db: DB):
    require(actor.identity_admin, 'ROLE_FORBIDDEN', '需要身份管理员权限')
    lock_project(db, 'identity-account-limit')
    def run():
        count = len(db.scalars(select(m.User.id).where(m.User.active.is_(True))).all())
        require(count < 10, 'ACCOUNT_LIMIT', '第一阶段最多10个活动账号', 409)
        user = m.User(username=body.username, display_name=body.display_name, person_id=body.person_id,
                      password_hash=hasher.hash(body.password))
        db.add(user); db.flush()
        audit(db, actor, user.id, 'user_created')
        return user_info(user)
    # Persist a digest, never an initial password, in the idempotency record.
    return ok(command(db, actor, request, {**body.model_dump(exclude={'password'}), 'password_digest': digest(body.password)}, run))


@router.get('/users')
def users(actor: Actor, db: DB):
    require(actor.identity_admin, 'ROLE_FORBIDDEN', '需要身份管理员权限')
    audit(db, actor, 'identity', 'users_viewed')
    return ok([user_info(u) for u in db.scalars(select(m.User).order_by(m.User.username))])


@router.post('/users/{user_id}/status')
def user_status(user_id: str, body: s.UserStatus, request: Request, actor: Actor, db: DB):
    require(actor.identity_admin and actor.id != user_id, 'ROLE_FORBIDDEN', '无权修改此账号状态')
    user = db.get(m.User, user_id); require(user, 'NOT_FOUND', '账号不存在', 404)
    def run():
        check_version(user, body.expected_version)
        if body.active and not user.active:
            require(len(db.scalars(select(m.User.id).where(m.User.active.is_(True))).all()) < 10,
                    'ACCOUNT_LIMIT', '第一阶段最多10个活动账号', 409)
        user.active = body.active; bump(user)
        db.execute(update(m.Session).where(m.Session.user_id == user_id).values(revoked=True))
        audit(db, actor, user_id, 'user_enabled' if body.active else 'user_disabled')
        return user_info(user)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/users/{user_id}/password-reset')
def reset_password(user_id: str, body: s.PasswordReset, request: Request, actor: Actor, db: DB):
    require(actor.identity_admin and actor.id != user_id, 'ROLE_FORBIDDEN', '无权重置此账号密码')
    user = db.get(m.User, user_id); require(user, 'NOT_FOUND', '账号不存在', 404)
    def run():
        check_version(user, body.expected_version)
        user.password_hash = hasher.hash(body.new_password)
        user.must_change_password = True; user.failed_logins = 0; user.locked_until = None; bump(user)
        db.execute(update(m.Session).where(m.Session.user_id == user_id).values(revoked=True))
        audit(db, actor, user_id, 'password_reset')
        return user_info(user)
    return ok(command(db, actor, request, {**body.model_dump(exclude={'new_password'}), 'password_digest': digest(body.new_password)}, run))
