"""Single-user password gate, session cookies and encryption of stored API keys."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from collections import defaultdict, deque

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner

from . import db
from .config import get_config

COOKIE_NAME = "homl_session"
SESSION_MAX_AGE = 30 * 24 * 3600


def _fernet() -> Fernet:
    digest = hashlib.sha256(("api-keys:" + get_config().secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return ""


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + ":" + digest.hex()


def _verify_hash(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split(":")
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(digest.hex(), digest_hex)


def password_is_set() -> bool:
    return bool(get_config().app_password or db.get_setting("password_hash"))


def check_password(password: str) -> bool:
    env = get_config().app_password
    if env:
        return hmac.compare_digest(password.encode(), env.encode())
    stored = db.get_setting("password_hash")
    return bool(stored) and _verify_hash(password, stored)


def set_password(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(400, "Use at least 8 characters.")
    db.set_setting("password_hash", hash_password(password))
    # Changing the password signs every existing session out.
    db.set_setting("session_epoch", os.urandom(8).hex())


def _signer() -> TimestampSigner:
    return TimestampSigner(get_config().secret_key, salt="session")


def make_session() -> str:
    epoch = db.get_setting("session_epoch", "0")
    return _signer().sign(epoch).decode()


def session_valid(token: str | None) -> bool:
    if not token:
        return False
    try:
        epoch = _signer().unsign(token, max_age=SESSION_MAX_AGE).decode()
    except (BadSignature, SignatureExpired):
        return False
    return epoch == db.get_setting("session_epoch", "0")


def require_session(request: Request) -> None:
    if not session_valid(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(401, "Sign in first.")


class LoginLimiter:
    """At most 10 failed attempts per client per 15 minutes."""

    def __init__(self, limit: int = 10, window: float = 900) -> None:
        self.limit = limit
        self.window = window
        self.failures: dict[str, deque[float]] = defaultdict(deque)

    def check(self, client: str) -> None:
        q = self.failures[client]
        cutoff = time.time() - self.window
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(429, "Too many attempts. Try again in a few minutes.")

    def fail(self, client: str) -> None:
        self.failures[client].append(time.time())


login_limiter = LoginLimiter()
