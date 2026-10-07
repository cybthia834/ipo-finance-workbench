import secrets
from datetime import timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, Request
from sqlalchemy import and_, exists, or_, select

from . import models as m
from .common import DB, DomainError, digest, require
from .config import settings

hasher = PasswordHasher()
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))


def verify_password(encoded, password):
    try:
        return hasher.verify(encoded, password)
    except VerificationError:
        return False


def current_user(request: Request, db: DB):
    token = request.cookies.get('finance_session', '')
    session = db.scalar(select(m.Session).where(m.Session.token_hash == digest(token), m.Session.revoked.is_(False)))
    user = db.get(m.User, session.user_id) if session else None
    instant = m.now()
    require(user and user.active and session.expires_at > instant and
            session.last_seen_at + timedelta(minutes=settings.session_idle_minutes) > instant,
            'UNAUTHENTICATED', '请重新登录', 401)
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        require(request.headers.get('origin') == settings.app_origin, 'ORIGIN_REJECTED', '请求来源无效')
        require(secrets.compare_digest(session.csrf_hash, digest(request.headers.get('x-csrf-token', ''))),
                'CSRF_REJECTED', '会话校验失败，请重新登录')
    if user.must_change_password and request.url.path not in ('/api/v1/me', '/api/v1/auth/password', '/api/v1/auth/logout'):
        raise DomainError('PASSWORD_CHANGE_REQUIRED', '请先更新首次登录密码')
    session.last_seen_at = instant
    request.state.actor_id = user.id
    request.state.session = session
    return user


Actor = Annotated[m.User, Depends(current_user)]


def membership(db, user, project_id, roles=None):
    member = db.scalar(select(m.Membership).where(m.Membership.project_id == project_id,
                                                m.Membership.user_id == user.id, m.Membership.active.is_(True)).execution_options(populate_existing=True))
    require(member and member.org_ids and set(member.roles) & {'cfo', 'pmo', 'owner', 'reviewer'},
            'PROJECT_FORBIDDEN', '无权访问此项目')
    if roles:
        require(set(member.roles) & set(roles), 'ROLE_FORBIDDEN', '当前角色不能执行此操作')
    return member


def scoped_org(member, org_id):
    require(org_id in member.org_ids, 'SCOPE_FORBIDDEN', '无权访问该主体')


def distinct(db, actor, others):
    for user_id in set(others):
        if user_id:
            other = db.get(m.User, user_id)
            require(other and other.person_id != actor.person_id,
                    'SELF_REVIEW_FORBIDDEN', '提交人与复核、批准或验证人必须为不同人员')


def assigned(db, project_id, org_id, user_id, roles):
    user = db.get(m.User, user_id)
    require(user and user.active, 'INVALID_ASSIGNEE', '分派人员不可用', 422)
    mem = membership(db, user, project_id, roles)
    scoped_org(mem, org_id)
    return user


def item_query(db, user, project_id):
    member = membership(db, user, project_id)
    q = select(m.Checklist).where(m.Checklist.project_id == project_id, m.Checklist.org_id.in_(member.org_ids))
    if not set(member.roles) & {'cfo', 'pmo'}:
        q = q.where(or_(m.Checklist.owner_id == user.id, m.Checklist.reviewer_id == user.id))
    return q


def item_access(db, user, item_id):
    row = db.get(m.Checklist, item_id)
    require(row, 'NOT_FOUND', '记录不存在', 404)
    require(db.scalar(item_query(db, user, row.project_id).where(m.Checklist.id == item_id)),
            'OBJECT_FORBIDDEN', '无权访问该资料需求')
    return row


def policy_valid():
    return and_(m.Policy.state == 'active', m.Policy.expires_at > m.now())


def evidence_query(db, user, project_id):
    member = membership(db, user, project_id)
    q = select(m.Evidence).join(m.Policy, m.Policy.id == m.Evidence.policy_id).where(
        m.Evidence.project_id == project_id, m.Evidence.org_id.in_(member.org_ids), policy_valid())
    if not set(member.roles) & {'cfo', 'pmo'}:
        related = exists(select(m.EvidenceLink.id).join(m.Checklist, m.Checklist.id == m.EvidenceLink.item_id).where(
            m.EvidenceLink.evidence_id == m.Evidence.id,
            or_(m.Checklist.owner_id == user.id, m.Checklist.reviewer_id == user.id)))
        issue_related = exists(select(m.IssueEvidence.id).join(m.EvidenceVersion, m.EvidenceVersion.id == m.IssueEvidence.version_id)
            .join(m.Issue, m.Issue.id == m.IssueEvidence.issue_id).where(
                m.EvidenceVersion.evidence_id == m.Evidence.id,
                or_(m.Issue.owner_id == user.id, m.Issue.verifier_id == user.id)))
        q = q.where(or_(m.Evidence.owner_id == user.id, related, issue_related))
    return q


def evidence_access(db, user, evidence_id):
    row = db.get(m.Evidence, evidence_id)
    require(row, 'NOT_FOUND', '记录不存在', 404)
    require(db.scalar(evidence_query(db, user, row.project_id).where(m.Evidence.id == evidence_id)),
            'EVIDENCE_FORBIDDEN', '目录授权无效或无权访问')
    return row


def issue_query(db, user, project_id):
    member = membership(db, user, project_id)
    q = select(m.Issue).where(m.Issue.project_id == project_id, m.Issue.org_id.in_(member.org_ids))
    if not set(member.roles) & {'cfo', 'pmo'}:
        q = q.where(or_(m.Issue.owner_id == user.id, m.Issue.verifier_id == user.id))
    return q


def issue_access(db, user, issue_id):
    row = db.get(m.Issue, issue_id)
    require(row, 'NOT_FOUND', '记录不存在', 404)
    require(db.scalar(issue_query(db, user, row.project_id).where(m.Issue.id == issue_id)),
            'OBJECT_FORBIDDEN', '无权访问该整改事项')
    return row
