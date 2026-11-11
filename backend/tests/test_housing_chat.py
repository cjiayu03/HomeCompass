import asyncio
import pytest
from fastapi import HTTPException
from app import housing_chat


def chat_request(**kwargs):
    defaults = {'available_towns': ['Clementi', 'Jurong East', 'Jurong West', 'Bedok', 'Tampines'], 'available_flat_types': ['2 ROOM', '3 ROOM', '4 ROOM']}
    return housing_chat.HousingChatRequest(**{**defaults, **kwargs})


def test_chat_uses_only_server_evidence_and_falls_back_on_unavailable(monkeypatch):
    calls = []
    async def generate(prompt, schema, size, **kwargs):
        calls.append((prompt, kwargs['model_override']))
        if len(calls) == 1:
            raise HTTPException(status_code=502, detail={'code': 'AI_PROVIDER_UNAVAILABLE'})
        return '{"reply":"I can search Clementi.","action":"search","filters":{"town":"CLEMENTI"}}', kwargs['model_override']
    monkeypatch.setattr(housing_chat, '_generate_json', generate)
    request = chat_request(message='Find Clementi', history=[])
    result, model = asyncio.run(housing_chat.housing_chat(request, [{'address': '123 CLEMENTI', 'town': 'CLEMENTI'}]))
    assert [c[1] for c in calls] == ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
    assert result.action == 'search' and result.filters.towns == ['Clementi']
    assert model == 'gemini-3.1-flash-lite'
    assert '123 CLEMENTI' in calls[0][0]


def test_chat_does_not_fallback_for_invalid_key(monkeypatch):
    calls = []
    async def generate(*args, **kwargs):
        calls.append(1)
        raise HTTPException(status_code=502, detail={'code': 'AI_PROVIDER_REJECTED'})
    monkeypatch.setattr(housing_chat, '_generate_json', generate)
    with pytest.raises(HTTPException):
        asyncio.run(housing_chat.housing_chat(chat_request(message='hello'), []))
    assert len(calls) == 1


def test_chat_endpoint_requires_login_and_uses_only_verified_record_fields(monkeypatch):
    import httpx
    from app import main
    from app.security import require_active_user
    from app.rate_limit import RateLimiter
    async def user(): return {'id': 'test-user'}
    async def home_detail(home_id):
        return {'id': home_id, 'town': 'CLEMENTI', 'address': '123 CLEMENTI', 'private_unrelated': 'do not forward'}
    seen = []
    async def chat(request, evidence):
        assert request.available_towns == ['Clementi']
        assert request.available_flat_types == ['4 ROOM']
        seen.extend(evidence)
        return housing_chat.HousingChatReply(reply='A historical record.', action='answer'), 'gemini-3.5-flash-lite'
    async def options(): return {'towns': ['Clementi'], 'flatTypes': ['4 ROOM']}
    monkeypatch.setattr(main, 'search_options', options)
    monkeypatch.setattr(main, 'home_detail', home_detail)
    monkeypatch.setattr(main, 'housing_chat', chat)
    monkeypatch.setattr(main, 'ai_interpret_limiter', RateLimiter(max_requests=10, window_seconds=60))
    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as c:
            denied = await c.post('/api/v1/ai/chat', json={'message': 'hello'})
            main.app.dependency_overrides[require_active_user] = user
            try:
                response = await c.post('/api/v1/ai/chat', json={'message': 'hello', 'home_ids': ['h1'], 'available_towns': ['Invented Client Town'], 'available_flat_types': ['Invented Client Type']})
                invalid = await c.post('/api/v1/ai/chat', json={'message': 'hello', 'home_ids': ['h1'], 'records': [{'price': 1}]})
            finally:
                main.app.dependency_overrides.pop(require_active_user, None)
            return denied, response, invalid
    denied, response, invalid = asyncio.run(send())
    assert denied.status_code == 401
    assert response.status_code == 200 and response.json()['recordsUsed'] == 1
    assert response.headers['cache-control'] == 'no-store'
    assert seen == [{'id': 'h1', 'town': 'CLEMENTI', 'address': '123 CLEMENTI'}]
    assert invalid.status_code == 422


def test_explicit_price_and_flat_type_are_not_lost_from_search(monkeypatch):
    async def generate(*args, **kwargs):
        return '{"reply":"Searching.","action":"search","filters":{"town":"CLEMENTI"}}', 'gemini-3.5-flash-lite'
    monkeypatch.setattr(housing_chat, '_generate_json', generate)
    reply, _ = asyncio.run(housing_chat.housing_chat(chat_request(message='Find 4-room flats in Clementi under $700,000'), []))
    assert reply.filters.budget == 700000
    assert reply.filters.flat_type == '4 ROOM'


@pytest.mark.parametrize(('message', 'expected'), [
    ('Budget under $700k', 700000),
    ('maximum budget of SGD 1.2m', 1200000),
    ('up to $650,000', 650000),
    ('How much does a 4-room flat cost?', None),
])
def test_recognizes_unambiguous_price_ceiling(message, expected):
    filters = housing_chat.ChatSearchFilters()
    housing_chat._preserve_explicit_filters(message, filters)
    assert filters.budget == expected


def test_stream_emits_text_then_validated_search_and_ignores_done_marker(monkeypatch):
    import json
    import httpx
    from app import ai
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key-value')
    async def reserve(*args): return object(), 0, 0, None
    async def settle(*args): pass
    monkeypatch.setattr(ai, '_reserve_usage', reserve)
    monkeypatch.setattr(ai, '_settle_usage', settle)
    events = [
        {'event_type': 'step.delta', 'delta': {'type': 'text', 'text': '{"action":"search","filters":{"towns":["Toa Payoh"],"flat_type":"4 ROOM","budget":650000,"budget_is_ceiling":true},'}},
        {'event_type': 'step.delta', 'delta': {'type': 'text', 'text': '"reply":"我会查找'}},
        {'event_type': 'step.delta', 'delta': {'type': 'text', 'text': ' Toa Payoh 的四房式组屋。"}'}},
        {'event_type': 'interaction.completed', 'interaction': {}},
    ]
    wire = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events) + 'data: [DONE]\n\n'
    real_client = httpx.AsyncClient
    def provider(request):
        body = json.loads(request.content)
        prompt = body['input']
        schema = body['response_format']['schema']
        assert list(schema['properties']) == ['action', 'filters', 'reply']
        assert set(schema['$defs']['ChatSearchFilters']['required']) == {'towns', 'flat_type', 'budget', 'budget_is_ceiling'}
        assert 'language of the latest user message' in prompt
        assert 'use English' in prompt
        assert 'Keep JSON keys and action values unchanged' in prompt
        return httpx.Response(200, text=wire)
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(provider), **kwargs))
    async def collect():
        request = chat_request(
            message='请帮我找一套大巴窑（Toa Payoh）的四房式组屋，预算为65万新元。',
            available_towns=['Toa Payoh'],
            history=[{'role': 'user', 'text': 'Help me find a home'}],
        )
        return [json.loads(item) async for item in housing_chat.stream_housing_chat(request, [])]
    result = asyncio.run(collect())
    assert [item['type'] for item in result] == ['text', 'text', 'done']
    assert result[0]['text'] == '我会查找'
    assert result[-1]['reply'] == '我会查找 Toa Payoh 的四房式组屋。'
    assert result[-1]['action'] == 'search'
    assert result[-1]['filters']['towns'] == ['Toa Payoh']
    assert result[-1]['filters']['budget'] == 650000
    assert result[-1]['filters']['budget_is_ceiling'] is True
    assert result[-1]['filters']['flat_type'] == '4 ROOM'


def test_family_search_preserves_flexible_budget_and_school_preference():
    filters = housing_chat.ChatSearchFilters()
    housing_chat._preserve_explicit_filters('I have two children and would want something close to a school, and my budget is around 800k. 2-room flat works, maybe in Jurong or in Clementi', filters)
    assert filters.budget == 800000 and filters.budget_is_ceiling is False
    assert filters.flat_type == '2 ROOM'
    assert filters.school_priority is True
    assert filters.max_school_distance_m is None


@pytest.mark.parametrize(('message', 'key'), [
    ('Please prioritize childcare near us', 'childcare'),
    ('Senior care is important to us', 'care'),
    ('Affordability is important', 'affordability'),
    ('I would prefer to be near a school', 'school'),
])
def test_varied_soft_priorities_do_not_invent_distances(message, key):
    filters = housing_chat.ChatSearchFilters()
    housing_chat._preserve_explicit_filters(message, filters)
    assert filters.priority_weights[key] == 3
    assert filters.max_school_distance_m is None
    assert filters.max_childcare_distance_m is None
    assert filters.max_care_distance_m is None


def test_does_not_override_model_with_a_negated_room_type():
    filters = housing_chat.ChatSearchFilters()
    housing_chat._preserve_explicit_filters('Not a 2-room flat please', filters)
    assert filters.flat_type is None


def test_markup_in_filter_is_retried_once_before_a_result_is_returned(monkeypatch):
    import json
    calls = []
    async def generate(prompt, schema, size, **kwargs):
        calls.append(kwargs['model_override'])
        town = 'Clementi</blockquote>]}]}</code></thought>' if len(calls) == 1 else 'Clementi'
        return json.dumps({'reply': 'Looking for matching records.', 'action': 'search', 'filters': {'towns': [town], 'flat_type': '4 ROOM', 'budget': 700000}}), kwargs['model_override']
    monkeypatch.setattr(housing_chat, '_generate_json', generate)
    request = chat_request(message='Find 4-room flats in Clementi under $700,000', available_towns=['Clementi'], available_flat_types=['4 ROOM'])
    result, _ = asyncio.run(housing_chat.housing_chat(request, []))
    assert calls == ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
    assert result.filters.towns == ['Clementi']


@pytest.mark.parametrize('recover', [True, False])
def test_stream_retries_invalid_filter_once_without_exposing_markup(monkeypatch, recover):
    import json
    import httpx
    from app import ai
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key-value')
    calls = []
    settlements = []
    async def reserve(*args): return object(), 0, 0, None
    async def settle(*args): settlements.append(1)
    monkeypatch.setattr(ai, '_reserve_usage', reserve)
    monkeypatch.setattr(ai, '_settle_usage', settle)
    def provider(request):
        body = json.loads(request.content)
        calls.append(body)
        town = 'Clementi' if recover and len(calls) == 2 else 'Clementi</blockquote>]}]}</code></thought>'
        raw = json.dumps({'reply': 'Checking the search.', 'action': 'search', 'filters': {'towns': [town], 'flat_type': '4 ROOM', 'budget': 700000}})
        events = [{'event_type': 'step.delta', 'delta': {'type': 'text', 'text': raw}}, {'event_type': 'interaction.completed', 'interaction': {}}]
        return httpx.Response(200, text=''.join('data: ' + json.dumps(event) + '\n\n' for event in events) + 'data: [DONE]\n\n')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(provider), **kwargs))
    async def collect():
        return [json.loads(item) async for item in housing_chat.stream_housing_chat(chat_request(message='Find 4-room flats in Clementi under $700,000'), [])]
    events = asyncio.run(collect())
    assert len(calls) == 2 and len(settlements) == 2
    assert [call['model'] for call in calls] == ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
    assert all(call['store'] is False for call in calls)
    assert calls[0]['response_format']['schema']['$defs']['ChatSearchFilters']['properties']['towns']['items']['enum'] == ['Clementi', 'Jurong East', 'Jurong West', 'Bedok', 'Tampines']
    assert 'previous attempt could not be validated' in calls[1]['input']
    assert '</blockquote>' not in json.dumps(events)
    assert len([event for event in events if event['type'] == 'reset']) == 1
    assert events[-1]['type'] == 'done'
    if recover:
        assert events[-1]['filters']['towns'] == ['Clementi']
    else:
        assert events[-1]['manualFallback'] is True
        assert events[-1]['filters'] is None
        assert events[-1]['action'] == 'answer'
        assert 'Filters' in events[-1]['reply']
        assert 'unchanged' in events[-1]['reply']


def test_context_does_not_include_saved_places_coordinates_or_internal_pagination():
    request = chat_request(message='Keep my budget but prioritize care', current_search={
        'budget': 700000,
        'towns': ['Clementi'],
        'query': 'private location query',
        'bounds': {'west': 103.7, 'east': 103.8, 'south': 1.3, 'north': 1.4},
        'place_constraints': [{'place_id': '12345678-1234-1234-1234-123456789abc', 'max_distance_m': 1000}],
    })
    prompt = housing_chat._chat_prompt(request, [{'town': 'Clementi', 'price': 650000}])
    assert '700000' in prompt and '650000' in prompt
    assert '12345678-1234-1234-1234-123456789abc' not in prompt
    assert '103.7' not in prompt
    assert 'private location query' not in prompt


def test_unknown_town_is_rejected_even_when_it_has_no_markup():
    with pytest.raises(ValueError, match='available choices'):
        housing_chat._validated_reply('{"reply":"Checking.","action":"search","filters":{"town":"Unknown Town"}}', chat_request(message='Find a home'))


def test_partial_reply_only_reads_root_reply_and_preserves_json_escapes():
    import json
    raw = '{"filters":{"town":"' + 'quoted \\"reply\\": \\"not the assistant\\"' + '"}'
    assert housing_chat._partial_reply(raw) == ''
    assert housing_chat._partial_reply('{"reply":"First\\nsecond') == 'First\nsecond'
    assert housing_chat._partial_reply(json.dumps({'filters': None, 'reply': 'A plain answer.'})) == 'A plain answer.'


def test_provider_schema_is_compact_but_server_still_checks_numeric_and_cross_field_ranges():
    import json
    schema = housing_chat._chat_schema(chat_request(message='Find a home'))
    assert 'maximum' not in json.dumps(schema) and 'maxItems' not in json.dumps(schema)
    with pytest.raises(ValueError):
        housing_chat._validated_reply('{"reply":"Checking.","action":"search","filters":{"budget":90000000}}', chat_request(message='Find a home'))
    with pytest.raises(ValueError):
        housing_chat._validated_reply('{"reply":"Checking.","action":"search","filters":{"max_floor_area_sqm":80}}', chat_request(message='Change maximum area', current_search={'min_floor_area_sqm': 100}))


def test_duplicate_towns_are_idempotent_without_changing_filter_values():
    raw = '{"reply":"Checking.","action":"search","filters":{"towns":["Clementi","Clementi"],"flat_type":"4 ROOM","budget":700000}}'
    result = housing_chat._validated_reply(raw, chat_request(message='Find a home'))
    assert result.filters.towns == ['Clementi']
    assert result.filters.flat_type == '4 ROOM' and result.filters.budget == 700000
    with pytest.raises(ValueError):
        housing_chat._validated_reply(raw + '</thought>', chat_request(message='Find a home'))
