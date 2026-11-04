import os
from slowapi import Limiter
from slowapi.util import get_remote_address

# Disable rate limiting in test environment
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() != "false"

if RATE_LIMIT_ENABLED:
    limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])
else:
    # No-op limiter for tests
    class NoOpLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator
    limiter = NoOpLimiter()