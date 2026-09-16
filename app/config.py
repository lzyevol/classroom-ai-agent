from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    neo4j_uri: str = "neo4j://localhost:7687"
    neo4j_username: str = "neo4j"
    neo4j_password: str = ""
    neo4j_database: str = "neo4j"

    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com"

    qwen_tts_api_key: str = ""

    redis_url: str = "redis://127.0.0.1:6379/0"
    sqlite_db_path: Path | None = None
    job_ttl_seconds: int = 86400

    auth_session_days: int = 7

    demo_student_password: str = "student123"
    demo_teacher_password: str = "teacher123"
    demo_admin_password: str = "admin123"


settings = Settings()
