"""Durable bounded retries and export retention."""
from alembic import op

revision = '0004'
down_revision = '0003'


def upgrade():
    op.execute('ALTER TABLE job ADD COLUMN attempt_token varchar(36), ADD COLUMN lease_until timestamptz, ADD COLUMN heartbeat_at timestamptz, ADD COLUMN next_run_at timestamptz')
    op.execute('CREATE INDEX ix_job_claim ON job(state, next_run_at, created_at)')
    op.execute('ALTER TABLE export_artifact ADD COLUMN deleted_at timestamptz')


def downgrade():
    raise RuntimeError('Use a reviewed forward migration; task history must be retained.')
