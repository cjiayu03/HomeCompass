"""Password recovery: scoped expiring capabilities; SMTP is configured explicitly."""
from __future__ import annotations

import asyncio
import os
import logging

import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlsplit

import asyncpg
from fastapi import HTTPException

from . import database
from .local_auth import hash_session_token, new_session_token

logger = logging.getLogger(__name__)


def mail_configuration() -> dict | None:
    host, sender, origin = (os.getenv(k, '').strip() for k in ('SMTP_HOST', 'SMTP_FROM', 'PASSWORD_RESET_ORIGIN'))
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return None
    if not host or not sender or parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        return None
    if parsed.scheme != 'https' and parsed.hostname not in ('localhost', '127.0.0.1'):
        return None
    try:
        port = int(os.getenv('SMTP_PORT', '587'))
        if not 1 <= port <= 65535:
            return None
    except ValueError:
        return None
    return {'host': host, 'sender': sender, 'origin': origin.rstrip('/'), 'port': port, 'username': os.getenv('SMTP_USERNAME'), 'password': os.getenv('SMTP_PASSWORD'), 'ssl': os.getenv('SMTP_SSL') == '1'}


async def send_reset_email(email: str, token: str, config: dict) -> None:
    message = EmailMessage()
    message['Subject'] = 'Reset your HomeCompass password'
    message['From'] = config['sender']
    message['To'] = email
    # Fragments stay out of HTTP requests, referrers and proxy access logs.
    message.set_content(f"Open this single-use link within 30 minutes to reset your password:\n\n{config['origin']}/reset-password#token={token}\n\nIf you did not request this, ignore this message.")
    def deliver():
        options = {'timeout': 10}
        if config['ssl']:
            options['context'] = ssl.create_default_context()
        client = smtplib.SMTP_SSL if config['ssl'] else smtplib.SMTP
        with client(config['host'], config['port'], **options) as smtp:
            if not config['ssl']:
                smtp.starttls(context=ssl.create_default_context())
            if config['username']:
                smtp.login(config['username'], config['password'] or '')
            smtp.send_message(message)
    await asyncio.to_thread(deliver)


async def store_reset_token(user_id, token_hash: str, expires_at: datetime) -> None:
    async with database.require_pool().acquire() as connection:
        async with connection.transaction():
            # Serialize requests and password changes on the identity row.
            await connection.fetchval('SELECT user_id FROM local_auth_identity WHERE user_id = $1 FOR UPDATE', user_id)
            await connection.execute('DELETE FROM password_recovery WHERE user_id = $1 OR expires_at <= now()', user_id)
            await connection.execute('INSERT INTO password_recovery (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', user_id, token_hash, expires_at)


async def consume_reset_token(token_hash: str, password_hash: str) -> bool:
    async with database.require_pool().acquire() as connection:
        async with connection.transaction():
            user_id = await connection.fetchval('SELECT user_id FROM password_recovery WHERE token_hash = $1', token_hash)
            if user_id is None:
                return False
            await connection.fetchval('SELECT user_id FROM local_auth_identity WHERE user_id = $1 FOR UPDATE', user_id)
            consumed = await connection.fetchval('DELETE FROM password_recovery WHERE token_hash = $1 AND expires_at > now() RETURNING user_id', token_hash)
            if consumed is None:
                return False
            await connection.execute('UPDATE local_auth_identity SET password_hash = $2, updated_at = now() WHERE user_id = $1', user_id, password_hash)
            await connection.execute('UPDATE local_auth_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', user_id)
            await connection.execute('DELETE FROM password_recovery WHERE user_id = $1', user_id)
    return True


async def request_password_reset(email: str, config: dict) -> None:
    try:
        identity = await database.get_local_auth_identity_by_email(email)
        if identity is None:
            return
        token = new_session_token()
        await store_reset_token(identity["user_id"], hash_session_token(token), datetime.now(timezone.utc) + timedelta(minutes=30))
        await send_reset_email(email, token, config)
    except (asyncpg.PostgresError, OSError, smtplib.SMTPException, HTTPException):
        logger.warning("Password recovery delivery could not be completed.")
