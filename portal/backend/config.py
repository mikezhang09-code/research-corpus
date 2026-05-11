from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # Cloudflare R2
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket_name: str = "research-portal"
    r2_endpoint_url: str
    r2_public_url: str = ""

    # Portal
    portal_host: str = "0.0.0.0"
    portal_port: int = 8000
    portal_env: str = "development"

    # NotebookLM (optional override)
    notebooklm_home: str = ""

    # Claude-compatible chat API (Xiaomi MiMo proxy)
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://token-plan-sgp.xiaomimimo.com/anthropic"
    anthropic_model: str = "mimo-v2.5-pro"
    anthropic_max_tokens: int = 2048

    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
