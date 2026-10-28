import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request
from starlette.responses import Response
from app import main, recovery
from app.schemas import ForgotPasswordRequest, ResetPasswordRequest


def request():
    return Request({'type': 'http', 'method': 'POST', 'path': '/', 'headers': [], 'client': ('127.0.0.1', 123)})


def test_unconfigured_recovery_never_claims_delivery(monkeypatch):
    monkeypatch.setattr(recovery, 'mail_configuration', lambda: None)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(main.forgot_password(ForgotPasswordRequest(email='test@example.com'), request(), BackgroundTasks()))
    assert exc.value.status_code == 503
    assert 'unavailable' in exc.value.detail['message'].lower()


def test_existing_and_unknown_addresses_have_same_response(monkeypatch):
    monkeypatch.setattr(recovery, 'mail_configuration', lambda: {'configured': True})
    monkeypatch.setattr(main, '_check_auth_rate_limit', lambda *args: None)
    identity = AsyncMock(return_value=None)
    monkeypatch.setattr(main.database, 'get_local_auth_identity_by_email', identity)
    store = AsyncMock()
    monkeypatch.setattr(recovery, 'store_reset_token', store)
    mail = AsyncMock()
    monkeypatch.setattr(recovery, 'send_reset_email', mail)
    monkeypatch.setattr(main.database, 'require_pool', lambda: object())
    unknown_tasks = BackgroundTasks()
    unknown = asyncio.run(main.forgot_password(ForgotPasswordRequest(email='unknown@example.com'), request(), unknown_tasks))
    asyncio.run(unknown_tasks())
    identity.return_value = {'user_id': 'user-id', 'email': 'known@example.com'}
    known_tasks = BackgroundTasks()
    known = asyncio.run(main.forgot_password(ForgotPasswordRequest(email='known@example.com'), request(), known_tasks))
    asyncio.run(known_tasks())
    assert known == unknown
    token_hash, expires = store.call_args.args[1:]
    assert len(token_hash) == 64
    assert token_hash != mail.call_args.args[1]
    assert datetime.now(timezone.utc) < expires < datetime.now(timezone.utc) + timedelta(minutes=31)


def test_reset_consumes_token_and_clears_session(monkeypatch):
    monkeypatch.setattr(main, '_check_auth_rate_limit', lambda *args: None)
    consume = AsyncMock(return_value=True)
    monkeypatch.setattr(recovery, 'consume_reset_token', consume)
    response = Response()
    assert asyncio.run(main.reset_password(ResetPasswordRequest(token='a'*43, password='new-password'), request(), response)) == {'ok': True}
    assert len(consume.call_args.args[0]) == 64
    assert 'Max-Age=0' in response.headers['set-cookie']
    consume.return_value = False
    with pytest.raises(HTTPException) as exc:
        asyncio.run(main.reset_password(ResetPasswordRequest(token='a'*43, password='new-password'), request(), Response()))
    assert exc.value.status_code == 400


def test_logout_failure_keeps_browser_session(monkeypatch):
    monkeypatch.setattr(main.database, 'revoke_local_session', AsyncMock(side_effect=OSError('offline')))
    req = request()
    req._cookies = {main.SESSION_COOKIE_NAME: 'secret-session'}
    result = asyncio.run(main.logout_local_account(req, Response()))
    assert result.status_code == 503
    assert 'set-cookie' not in result.headers


@pytest.mark.parametrize('expired', [False, True])
def test_real_token_consumption_is_expiry_checked_and_single_use(monkeypatch, expired):
    from contextlib import asynccontextmanager
    class Connection:
        def __init__(self):
            self.token = True
            self.updates = []
        @asynccontextmanager
        async def transaction(self):
            yield self
        async def fetchval(self, sql, *args):
            if sql.startswith('SELECT user_id FROM password_recovery'):
                return 'user-id' if self.token else None
            if 'FOR UPDATE' in sql:
                return 'user-id'
            if sql.startswith('DELETE FROM password_recovery'):
                if expired or not self.token:
                    return None
                self.token = False
                return 'user-id'
            raise AssertionError(sql)
        async def execute(self, sql, *args):
            self.updates.append(sql)
    connection = Connection()
    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield connection
    monkeypatch.setattr(recovery.database, 'require_pool', lambda: Pool())
    first = asyncio.run(recovery.consume_reset_token('a'*64, 'new-password-hash'))
    second = asyncio.run(recovery.consume_reset_token('a'*64, 'new-password-hash'))
    assert first is (not expired)
    assert second is False
    if expired:
        assert connection.updates == []
    else:
        assert any('UPDATE local_auth_identity' in sql for sql in connection.updates)
        assert any('UPDATE local_auth_session' in sql for sql in connection.updates)


def test_smtp_delivery_uses_tls_and_fragment_token(monkeypatch):
    async def inline_thread(function): return function()
    monkeypatch.setattr(recovery.asyncio, 'to_thread', inline_thread)
    calls = []
    class SMTP:
        def __init__(self, *args, **kwargs): calls.append('connect')
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def starttls(self, **kwargs): calls.append('tls')
        def login(self, username, password): calls.append('login')
        def send_message(self, message): calls.append(message)
    monkeypatch.setattr(recovery.smtplib, 'SMTP', SMTP)
    config = {'host':'smtp.example.com','port':587,'sender':'noreply@example.com','origin':'https://example.com','username':'user','password':'secret','ssl':False}
    asyncio.run(recovery.send_reset_email('test@example.com', 'raw-token', config))
    assert calls[:3] == ['connect','tls','login']
    assert 'https://example.com/reset-password#token=raw-token' in calls[3].get_content()


def test_implicit_tls_verifies_the_smtp_certificate(monkeypatch):
    async def inline_thread(function): return function()
    monkeypatch.setattr(recovery.asyncio, 'to_thread', inline_thread)
    contexts = []
    class SMTP:
        def __init__(self, *args, **kwargs): contexts.append(kwargs['context'])
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def send_message(self, message): pass
    monkeypatch.setattr(recovery.smtplib, 'SMTP_SSL', SMTP)
    config = {'host':'smtp.example.com','port':465,'sender':'noreply@example.com','origin':'https://example.com','username':None,'password':None,'ssl':True}
    asyncio.run(recovery.send_reset_email('test@example.com', 'raw-token', config))
    assert contexts[0].check_hostname is True
    assert contexts[0].verify_mode == recovery.ssl.CERT_REQUIRED


def test_login_cannot_create_a_session_after_the_verified_password_changes(monkeypatch):
    from contextlib import asynccontextmanager
    from app import database
    class Connection:
        def __init__(self): self.password_hash = 'new-hash'; self.sessions = []
        @asynccontextmanager
        async def transaction(self): yield self
        async def fetchval(self, sql, user_id, expected_hash):
            assert 'FOR UPDATE' in sql
            return user_id if expected_hash == self.password_hash else None
        async def execute(self, sql, *args): self.sessions.append(args)
    connection = Connection()
    class Pool:
        @asynccontextmanager
        async def acquire(self): yield connection
    monkeypatch.setattr(database, 'require_pool', lambda: Pool())
    expiry = datetime.now(timezone.utc) + timedelta(days=1)
    assert asyncio.run(database.create_local_session('u', 'token-hash', expiry, 'old-verified-hash')) is False
    assert connection.sessions == []
    assert asyncio.run(database.create_local_session('u', 'token-hash', expiry, 'new-hash')) is True
    assert len(connection.sessions) == 1


def test_login_rejects_password_race_without_setting_session_cookie(monkeypatch):
    from app.schemas import AuthCredentials
    monkeypatch.setattr(main, '_check_auth_rate_limit', lambda *args: None)
    monkeypatch.setattr(main, 'verify_password', lambda *args: True)
    monkeypatch.setattr(main.database, 'get_local_auth_identity_by_email', AsyncMock(return_value={'user_id':'u','email':'me@example.com','password_hash':'old-verified-hash'}))
    create = AsyncMock(return_value=False)
    monkeypatch.setattr(main.database, 'create_local_session', create)
    response = Response()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(main.login_local_account(AuthCredentials(email='me@example.com',password='old-password'), request(), response))
    assert exc.value.status_code == 401
    assert create.call_args.args[-1] == 'old-verified-hash'
    assert 'set-cookie' not in response.headers


def test_password_change_locks_identity_before_session(monkeypatch):
    from contextlib import asynccontextmanager
    from app import database
    queries = []
    class Connection:
        @asynccontextmanager
        async def transaction(self): yield self
        async def fetchval(self, sql, *args): queries.append(sql); return 'u'
        async def execute(self, sql, *args): queries.append(sql)
    class Pool:
        @asynccontextmanager
        async def acquire(self): yield Connection()
    monkeypatch.setattr(database, 'require_pool', lambda: Pool())
    assert asyncio.run(database.change_local_password('u','s','old','new')) is True
    assert 'local_auth_identity' in queries[0] and 'FOR UPDATE' in queries[0]
    assert 'local_auth_session' in queries[1] and 'FOR UPDATE' in queries[1]
