from datetime import datetime, timedelta

_store: dict = {}


def cache_get(key: str):
    entry = _store.get(key)
    if entry:
        value, expires = entry
        if datetime.now() < expires:
            return value
        del _store[key]
    return None


def cache_set(key: str, value, ttl_seconds: int = 3600):
    _store[key] = (value, datetime.now() + timedelta(seconds=ttl_seconds))


def cache_clear():
    _store.clear()
