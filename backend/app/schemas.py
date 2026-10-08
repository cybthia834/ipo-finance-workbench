from datetime import date as DateValue, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Login(Input):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class PasswordChange(Input):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    current_password: str
    new_password: str = Field(min_length=12, max_length=200)


class UserCreate(Input):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    username: str = Field(pattern=r'^[a-zA-Z0-9_.-]{3,60}$')
    display_name: str = Field(min_length=1, max_length=80)
    person_id: str = Field(min_length=1, max_length=36)
    password: str = Field(min_length=12, max_length=200)


class OrgInput(Input):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)


class PeriodInput(Input):
    label: str = Field(min_length=1, max_length=60)
    start: DateValue
    end: DateValue


class ProjectCreate(Input):
    name: str = Field(min_length=1, max_length=120)
    exchange: Literal['unknown', 'sse', 'szse'] = 'unknown'
    organizations: list[OrgInput] = Field(min_length=1, max_length=30)
    periods: list[PeriodInput] = Field(min_length=1, max_length=20)


class MemberInput(Input):
    user_id: str
    roles: list[Literal['cfo', 'pmo', 'owner', 'reviewer']] = Field(min_length=1)
    org_ids: list[str] = Field(min_length=1)


class ProjectBootstrap(ProjectCreate):
    initial_cfo_id: str


class Versioned(Input):
    expected_version: int = Field(ge=1)


class Reason(Input):
    reason: str = Field(min_length=3, max_length=500)


class UserStatus(Versioned, Reason):
    active: bool


class PasswordReset(Versioned, Reason):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    new_password: str = Field(min_length=12, max_length=200)


class Generation(Input):
    template_version_id: str
    scope_version: int = Field(ge=1)


class AssignRow(Versioned):
    item_id: str
    owner_id: str
    reviewer_id: str
    due: DateValue


class AssignBatch(Input):
    rows: list[AssignRow] = Field(min_length=1, max_length=100)


class Applicability(Versioned, Reason):
    value: Literal['pending', 'applicable', 'not_applicable']


class Decision(Reason):
    approve: bool


class PolicyInput(Input):
    org_id: str
    reference: str = Field(min_length=3, max_length=100)
    allowed_fields: list[Literal['document_type', 'department', 'location_code', 'acquisition', 'note', 'date', 'voucher_code']]
    expires_at: datetime


class Metadata(Input):
    document_type: str = Field(min_length=1, max_length=60)
    department: str = Field(min_length=1, max_length=80)
    location_code: str = Field(min_length=1, max_length=100)
    acquisition: Literal['not_collected', 'located', 'pending', 'restricted', 'unavailable', 'nonexistent'] = 'located'
    note: str = Field(default='', max_length=300)
    date: DateValue | None = None
    voucher_code: str | None = Field(default=None, max_length=80)

    @field_validator('note', 'location_code', 'voucher_code')
    @classmethod
    def no_embedded_files(cls, value):
        if value and any(s in value.lower() for s in ('http://', 'https://', 'file://', 'data:', 'base64,')):
            raise ValueError('目录字段不允许原件链接或内嵌内容')
        return value


class EvidenceCreate(Input):
    code: str = Field(min_length=1, max_length=80)
    mode: Literal['A'] = 'A'
    org_id: str
    period_id: str
    policy_id: str
    metadata: Metadata
    reason: str = Field(min_length=3, max_length=300)


class EvidenceUpdate(Versioned):
    metadata: Metadata
    reason: str = Field(min_length=3, max_length=300)


class EvidenceLinkInput(Versioned):
    evidence_id: str


class ReviewInput(Versioned, Reason):
    decision: Literal['accept', 'return', 'restricted_verified']
    checks: list[str]
    evidence_version_ids: list[str] = Field(min_length=1)
    verification_method: str | None = Field(default=None, max_length=100)
    verified_at: datetime | None = None


class TemplateUpgrade(Versioned, Reason):
    new_template_item_id: str
    decision: Literal['adopt', 'retain']


class GapInput(Input):
    item_id: str
    facts: str = Field(min_length=3, max_length=500)
    kind: Literal['missing', 'wrong_version', 'scope_mismatch', 'approval_missing', 'control', 'restricted', 'other']


class IssueCreate(Input):
    title: str = Field(min_length=3, max_length=160)
    facts: str = Field(min_length=3, max_length=500)
    kind: Literal['missing', 'wrong_version', 'scope_mismatch', 'approval_missing', 'control', 'restricted', 'other']
    severity: Literal['P0', 'P1', 'P2']
    org_id: str
    owner_id: str
    verifier_id: str
    due: DateValue
    gap_ids: list[str] = Field(default_factory=list)


class IssueActionInput(Versioned, Reason):
    evidence_version_ids: list[str] = Field(default_factory=list)


class Extension(Versioned, Reason):
    new_due: DateValue


class SnapshotInput(Input):
    org_id: str | None = None
    period_id: str | None = None
    purpose: str = Field(min_length=3, max_length=300)


class MetricInput(Input):
    task_type: str = Field(min_length=1, max_length=60)
    group: Literal['baseline', 'actual', 'maintenance']
    minutes: int = Field(ge=0, le=100000)
    count: int = Field(default=1, ge=1, le=100000)


class ViewInput(Input):
    project_id: str
    name: str = Field(min_length=1, max_length=80)
    filters: dict[str, str]


class TemplateEntry(Input):
    code: str = Field(pattern=r'^[A-Z]{2,8}-[0-9]{2,4}$')
    title: str = Field(min_length=3, max_length=160)
    domain: Literal['FIN', 'REV', 'AR', 'INV', 'CASH', 'TAX', 'RP', 'IC']
    source: str = Field(min_length=3, max_length=500)
    standard: str = Field(min_length=3, max_length=1000)
    checks: list[str] = Field(min_length=1, max_length=20)

    @field_validator('checks')
    @classmethod
    def valid_checks(cls, checks):
        if len(set(checks)) != len(checks) or any(not x.strip() or len(x) > 100 for x in checks):
            raise ValueError('检查点须唯一且不超过100字')
        return checks


class TemplateEdit(TemplateEntry):
    expected_hash: str = Field(min_length=64, max_length=64)
