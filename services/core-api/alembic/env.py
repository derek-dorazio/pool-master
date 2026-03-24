"""Alembic environment configuration for async PostgreSQL migrations."""

from logging.config import fileConfig

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import models here so Alembic can detect them for autogenerate
# from app.models import Base
# target_metadata = Base.metadata
target_metadata = None


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    # For async support, use async engine here when models are defined
    raise NotImplementedError("Configure async engine when models are ready")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
