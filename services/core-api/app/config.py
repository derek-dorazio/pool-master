"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Core API settings — loaded from environment or .env file."""

    # Application
    app_name: str = "poolmaster-core-api"
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/poolmaster"
    db_pool_size: int = 20
    db_max_overflow: int = 10

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    auth_issuer: str = ""
    auth_audience: str = ""
    auth_jwks_url: str = ""

    model_config = {"env_prefix": "POOLMASTER_", "env_file": ".env"}


settings = Settings()
