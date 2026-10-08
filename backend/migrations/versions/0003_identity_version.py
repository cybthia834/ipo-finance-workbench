"""Optimistic identity changes; no business data migration."""
from alembic import op

revision = '0003'
down_revision = '0002'


def upgrade():
    op.execute('ALTER TABLE user_account ADD COLUMN row_version integer NOT NULL DEFAULT 1')


def downgrade():
    raise RuntimeError('Use a reviewed forward migration; identity audit history must be retained.')
