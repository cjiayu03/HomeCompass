from __future__ import annotations

import hashlib
import re
import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError


_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PASSWORD_HASHER = PasswordHasher(type=Type.ID)


def normalize_email(email: str) -> str:
    if not isinstance(email, str):
        raise ValueError("Enter a valid email address.")
    normalized = email.strip().lower()
    if len(normalized) > 254 or not _EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid email address.")
    return normalized


def validate_password(password: str) -> str:
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise ValueError("Password must be between 8 and 128 characters.")
    return password


def hash_password(password: str) -> str:
    return _PASSWORD_HASHER.hash(validate_password(password))


def verify_password(password: str, password_hash: str) -> bool:
    if not isinstance(password, str) or not isinstance(password_hash, str):
        return False
    try:
        return _PASSWORD_HASHER.verify(password_hash, password)
    except (InvalidHashError, VerificationError, TypeError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    if not isinstance(token, str) or not token or len(token) > 256:
        raise ValueError("Session token is required.")
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
