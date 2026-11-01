from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

from .database import require_pool
from .security import is_configured_value
from .schemas import InterpretRequest, QueryInterpretation, RecordSummary

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
logger = logging.getLogger(__name__)


def _text_from_interaction(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    text_parts: list[str] = []
    for step in payload.get("steps", []):
        if step.get("type") == "model_output":
            text_parts.extend(part.get("text", "") for part in step.get("content", []) if part.get("type") == "text")
    if not text_parts:
        for item in payload.get("outputs", []):
            if item.get("type") == "text":
                text_parts.append(item.get("text", ""))
    return "\n".join(part for part in text_parts if part)


def _usage_tokens(payload: dict) -> tuple[int, int] | None:
    usage = payload.get("usage") or payload.get("usage_metadata") or payload.get("usageMetadata")
    if not usage:
        return None
    input_tokens = usage.get("input_tokens", usage.get("prompt_token_count", usage.get("promptTokenCount")))
    output_tokens = usage.get("output_tokens", usage.get("candidates_token_count", usage.get("candidatesTokenCount")))
    if input_tokens is None or output_tokens is None:
        return None
    return max(0, int(input_tokens)), max(0, int(output_tokens))


def _interaction_body(model: str, prompt: str, schema: dict, output_limit: int) -> dict:
    return {
        "model": model,
        "input": prompt,
        "store": False,
        "generation_config": {"max_output_tokens": output_limit, "thinking_level": "low"},
        "response_format": {"type": "text", "mime_type": "application/json", "schema": schema},
    }


def _provider_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return ""
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if not isinstance(error, dict):
        return ""
    message = error.get("message")
    return " ".join(message.split())[:400] if isinstance(message, str) else ""


def _monthly_cost(input_tokens: int, output_tokens: int) -> Decimal:
    input_rate = os.getenv("GEMINI_INPUT_USD_PER_MILLION")
    output_rate = os.getenv("GEMINI_OUTPUT_USD_PER_MILLION")
    if not input_rate or not output_rate:
        raise HTTPException(status_code=503, detail={"code": "AI_BILLING_UNCONFIGURED", "message": "Configure current model token rates and an approved monthly spend cap before enabling Gemini."})
    try:
        input_price = Decimal(input_rate)
        output_price = Decimal(output_rate)
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"code": "AI_BILLING_UNCONFIGURED", "message": "Gemini token rates are invalid; no request was sent."}) from exc
    if not input_price.is_finite() or not output_price.is_finite() or input_price < 0 or output_price < 0:
        raise HTTPException(status_code=503, detail={"code": "AI_BILLING_UNCONFIGURED", "message": "Gemini token rates must be finite, non-negative amounts; no request was sent."})
    return (Decimal(input_tokens) * input_price + Decimal(output_tokens) * output_price) / Decimal(1_000_000)


def gemini_configuration_ready() -> bool:
    if not is_configured_value(os.getenv("GEMINI_API_KEY")):
        return False
    try:
        cap = Decimal(os.getenv("GEMINI_MONTHLY_BUDGET_USD", ""))
        if not cap.is_finite() or cap <= 0:
            return False
        _monthly_cost(0, 0)
    except (InvalidOperation, HTTPException):
        return False
    return True


async def _reserve_usage(input_upper_bound: int, output_limit: int) -> tuple[object, Decimal, Decimal, object]:
    key = os.getenv("GEMINI_API_KEY")
    cap_value = os.getenv("GEMINI_MONTHLY_BUDGET_USD")
    if not is_configured_value(key):
        raise HTTPException(status_code=503, detail={"code": "AI_UNCONFIGURED", "message": "Gemini is disabled until a server-side API key is supplied."})
    if not cap_value:
        raise HTTPException(status_code=503, detail={"code": "AI_BUDGET_UNCONFIGURED", "message": "Gemini is disabled until the team sets a monthly spend cap."})
    try:
        cap = Decimal(cap_value)
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"code": "AI_BUDGET_INVALID", "message": "The configured Gemini monthly cap must be a positive dollar amount."}) from exc
    if not cap.is_finite() or cap <= 0:
        raise HTTPException(status_code=503, detail={"code": "AI_BUDGET_INVALID", "message": "The configured Gemini monthly cap must be a positive dollar amount."})
    reserve = _monthly_cost(input_upper_bound, output_limit)
    if reserve > cap:
        raise HTTPException(status_code=429, detail={"code": "AI_REQUEST_EXCEEDS_BUDGET", "message": "The configured monthly budget is too small for one bounded Gemini request."})
    pool = require_pool()
    now = datetime.now(timezone.utc)
    month = now.date().replace(day=1)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("INSERT INTO ai_monthly_usage (month_start) VALUES ($1) ON CONFLICT DO NOTHING", month)
            accepted = await connection.fetchval(
                """UPDATE ai_monthly_usage SET reserved_usd = reserved_usd + $1, request_count = request_count + 1, updated_at=now()
                   WHERE month_start = $2 AND spent_usd + reserved_usd + $1 <= $3 RETURNING TRUE""",
                reserve,
                month,
                cap,
            )
            if not accepted:
                raise HTTPException(status_code=429, detail={"code": "AI_MONTHLY_CAP_REACHED", "message": "The configured monthly Gemini spend cap has been reached."})
    return pool, reserve, cap, month


async def _settle_usage(pool, reserve: Decimal, month, actual: Decimal | None) -> None:
    async with pool.acquire() as connection:
        await connection.execute(
            """UPDATE ai_monthly_usage SET reserved_usd = GREATEST(0, reserved_usd - $1),
                      spent_usd = spent_usd + $2, updated_at=now() WHERE month_start = $3""",
            reserve,
            actual if actual is not None else reserve,
            month,
        )


async def _generate_json(prompt: str, schema: dict, input_size_bytes: int) -> tuple[str, str]:
    key = os.getenv("GEMINI_API_KEY")
    if not is_configured_value(key):
        raise HTTPException(status_code=503, detail={"code": "AI_UNCONFIGURED", "message": "Gemini is disabled until a server-side API key is supplied."})
    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    try:
        output_limit = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "512"))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"code": "AI_OUTPUT_LIMIT_INVALID", "message": "Gemini output-token limit must be between 64 and 2048."}) from exc
    if not 64 <= output_limit <= 2048:
        raise HTTPException(status_code=503, detail={"code": "AI_OUTPUT_LIMIT_INVALID", "message": "Gemini output-token limit must be between 64 and 2048."})
    # Two UTF-8 bytes per input token is a conservative reservation for the short prompts used here.
    pool, reserve, _cap, month = await _reserve_usage(input_size_bytes * 2, output_limit)
    body = _interaction_body(model, prompt, schema, output_limit)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(18.0, connect=4.0)) as client:
            response = await client.post(GEMINI_ENDPOINT, headers={"x-goog-api-key": key, "Content-Type": "application/json"}, json=body)
        if response.status_code == 429:
            await _settle_usage(pool, reserve, month, None)
            raise HTTPException(status_code=429, detail={"code": "AI_RATE_LIMITED", "message": "Gemini is rate-limited. Please retry shortly."})
        if response.status_code >= 400:
            await _settle_usage(pool, reserve, month, None)
            provider_message = _provider_error_message(response)
            logger.warning(
                "Gemini rejected a request (http_status=%s model=%s provider_message=%s)",
                response.status_code,
                model,
                provider_message or "not provided",
            )
            if response.status_code >= 500:
                detail = {"code": "AI_PROVIDER_UNAVAILABLE", "message": "Gemini is temporarily unavailable. Please retry shortly.", "providerStatus": response.status_code}
            else:
                detail = {"code": "AI_PROVIDER_REJECTED", "message": f"Gemini rejected the request (HTTP {response.status_code}). Check the server-side API key, model name, and request configuration.", "providerStatus": response.status_code}
            raise HTTPException(status_code=502, detail=detail)
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Gemini returned a non-object response")
        usage = _usage_tokens(payload)
        actual_cost = _monthly_cost(*usage) if usage else None
        await _settle_usage(pool, reserve, month, actual_cost)
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        await _settle_usage(pool, reserve, month, None)
        logger.warning("Gemini request failed before a valid response (model=%s error_type=%s)", model, type(exc).__name__)
        raise HTTPException(status_code=502, detail={"code": "AI_PROVIDER_UNAVAILABLE", "message": "Gemini is unavailable or returned an invalid response."}) from exc

    raw_text = _text_from_interaction(payload)
    if not raw_text:
        raise HTTPException(status_code=502, detail={"code": "AI_EMPTY_RESPONSE", "message": "Gemini returned no structured result."})
    return raw_text, model


async def interpret_query(request: InterpretRequest) -> tuple[QueryInterpretation, str]:
    prompt = (
        "Interpret a Singapore public-housing search query into only explicit filters. "
        "Do not invent a budget, town, flat type, distance threshold, prices, amenities, safety facts, or recommendations. "
        "Keep the original text in filters.query. Add priorities only for school access, childcare, care access, or affordability. "
        "If a value or distance threshold is not explicit and materially needed, set needs_clarification=true and ask one concise question. "
        "The application will search its own verified records; do not provide factual claims.\n\n"
        f"Query: {request.text}"
    )
    try:
        raw_text, model = await _generate_json(prompt, QueryInterpretation.model_json_schema(), len(prompt.encode("utf-8")))
        result = QueryInterpretation.model_validate_json(raw_text)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_SCHEMA_INVALID", "message": "Gemini returned a response outside the allowed filter schema."}) from exc
    result.filters.query = request.text
    return result, model


async def summarize_record(evidence: dict) -> tuple[RecordSummary, str]:
    prompt = (
        "Write a short, neutral overview of this historical HDB resale transaction using only the JSON evidence below. "
        "The access fields describe the nearest mapped service and a straight-line distance, not a walking route, travel time, "
        "eligibility, opening status, or suitability. Repeat dengue status only as the supplied state and label; preserve its "
        "freshness, coverage, and uncertainty. A no-active-cluster result is not proof of no dengue risk. The route_status field "
        "explains whether a route was calculated; never invent a route or commute estimate. Do not imply current availability, "
        "affordability, valuation, or recommendation. Each observation must cite exact evidence_fields present in the JSON. "
        "If evidence is missing or unavailable, state that limitation instead of filling the gap.\n\n"
        f"Evidence JSON: {json.dumps(evidence, ensure_ascii=False, separators=(',', ':'))}"
    )
    try:
        raw_text, model = await _generate_json(prompt, RecordSummary.model_json_schema(), len(prompt.encode("utf-8")))
        result = RecordSummary.model_validate_json(raw_text)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_SCHEMA_INVALID", "message": "Gemini returned a summary outside the allowed evidence schema."}) from exc
    allowed_fields = set(evidence)
    if any(set(item.evidence_fields) - allowed_fields for item in result.observations):
        raise HTTPException(status_code=502, detail={"code": "AI_EVIDENCE_REFERENCE_INVALID", "message": "Gemini returned an unknown evidence reference; no summary was shown."})
    return result, model
