import os
from alembic import context
from sqlalchemy import create_engine
from app.config import settings
from app.models import Base

url = os.environ.get('MIGRATION_DATABASE_URL')
if not url:
    from dotenv import dotenv_values
    from app.config import ROOT
    url = dotenv_values(ROOT / '.runtime/phase1/app.env').get('MIGRATION_DATABASE_URL')
if not url:
    raise RuntimeError('MIGRATION_DATABASE_URL is required')

with create_engine(url).connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
