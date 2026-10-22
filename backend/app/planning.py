"""Authenticated persistence for the user's planning workspace."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from .database import require_pool
from .schemas import PlanningWorkspaceRequest
from .security import require_active_user


router = APIRouter(prefix="/api/v1/planning", tags=["planning"])


def _decode_workspace_json(value, default):
    if value is None:
        return default
    if isinstance(value, str):
        return json.loads(value)
    return value


def _workspace_response(scenarios, decisions, revision: int) -> dict:
    try:
        validated = PlanningWorkspaceRequest.model_validate(
            {
                "scenarios": _decode_workspace_json(scenarios, []),
                "decisions": _decode_workspace_json(decisions, {}),
                "revision": revision,
            }
        )
    except (TypeError, ValueError, ValidationError, json.JSONDecodeError):
        raise HTTPException(
            status_code=500,
            detail={
                "code": "PLANNING_WORKSPACE_INVALID",
                "message": "The stored planning workspace is invalid.",
            },
        ) from None
    return validated.model_dump(mode="json")


@router.get("/workspace")
async def get_planning_workspace(
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """SELECT scenarios, decisions, revision
               FROM planning_workspace
               WHERE user_id = $1""",
            user["id"],
        )
    if row is None:
        return {"scenarios": [], "decisions": {}, "revision": 0}
    return _workspace_response(row["scenarios"], row["decisions"], int(row["revision"]))


@router.put("/workspace")
async def put_planning_workspace(
    request: PlanningWorkspaceRequest,
    user: dict = Depends(require_active_user),
) -> dict:
    pool = require_pool()
    payload = request.model_dump(mode="json")
    scenarios_json = json.dumps(payload["scenarios"], ensure_ascii=False, allow_nan=False)
    decisions_json = json.dumps(payload["decisions"], ensure_ascii=False, allow_nan=False)
    async with pool.acquire() as connection, connection.transaction():
        # Lock the owning account so creation, revision updates and deletion serialize.
        await connection.fetchval("SELECT id FROM user_account WHERE id=$1 FOR UPDATE", user["id"])
        current_revision = await connection.fetchval(
            "SELECT revision FROM planning_workspace WHERE user_id=$1", user["id"]
        )
        if int(current_revision or 0) != request.revision:
            raise HTTPException(status_code=409, detail={
                "code": "PLANNING_WORKSPACE_REVISION_CONFLICT",
                "message": "The planning workspace changed. Reload it before saving again.",
                "currentRevision": int(current_revision or 0),
            })
        row = await connection.fetchrow(
            """INSERT INTO planning_workspace (user_id, scenarios, decisions, revision)
               VALUES ($1, $2::jsonb, $3::jsonb, 1)
               ON CONFLICT (user_id) DO UPDATE SET
                   scenarios = EXCLUDED.scenarios,
                   decisions = EXCLUDED.decisions,
                   revision = planning_workspace.revision + 1,
                   updated_at = now()
               WHERE planning_workspace.revision = $4
                 AND planning_workspace.revision < 2147483647
               RETURNING revision""",
            user["id"],
            scenarios_json,
            decisions_json,
            request.revision,
        )
        if row is None:
            current_revision = await connection.fetchval(
                "SELECT revision FROM planning_workspace WHERE user_id = $1",
                user["id"],
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "PLANNING_WORKSPACE_REVISION_CONFLICT",
                    "message": "The planning workspace changed. Reload it before saving again.",
                    "currentRevision": int(current_revision or 0),
                },
            )
    payload["revision"] = int(row["revision"])
    return payload
