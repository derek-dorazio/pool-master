"""Root conftest — shared fixtures available to all test modules.

Fixtures defined here are automatically available to every test file
without importing. Add service-specific fixtures in the service's
own conftest.py within the appropriate test layer directory.
"""

import pytest


@pytest.fixture
def tenant_id():
    """A default tenant UUID for testing."""
    from uuid import UUID

    return UUID("00000000-0000-0000-0000-000000000001")


@pytest.fixture
def user_id():
    """A default user UUID for testing."""
    from uuid import UUID

    return UUID("00000000-0000-0000-0000-000000000002")
