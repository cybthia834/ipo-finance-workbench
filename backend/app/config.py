from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / '.runtime/phase1' / 'app.env', extra='ignore', hide_input_in_errors=True)
    app_env: Literal['development', 'test', 'production'] = 'development'
    database_url: str
    app_origin: str = 'http://127.0.0.1:5173'
    trusted_hosts: str = '127.0.0.1,localhost,testserver'
    directory_only: bool = True
    upload_enabled: bool = False
    ai_enabled: bool = False
    audit_required: bool = True
    session_idle_minutes: int = 30
    session_max_hours: int = 8
    export_ttl_hours: int = 24
    export_storage_root: Path = ROOT / '.runtime/phase1' / 'exports'
    demo_mode: bool = False

    @model_validator(mode='after')
    def validate_runtime(self):
        if not self.database_url.startswith('postgresql+psycopg://'):
            raise ValueError('PostgreSQL with psycopg is required')
        if not self.directory_only or self.upload_enabled or self.ai_enabled or not self.audit_required:
            raise ValueError('Directory-only and mandatory audit are required; uploads and AI must be disabled')
        if min(self.session_idle_minutes, self.session_max_hours, self.export_ttl_hours) <= 0:
            raise ValueError('Expiry values must be positive')
        if self.app_env == 'production':
            if self.demo_mode or not self.app_origin.startswith('https://') or '*' in self.trusted_hosts:
                raise ValueError('Production requires HTTPS, explicit hosts and no demo mode')
        return self


settings = Settings()
