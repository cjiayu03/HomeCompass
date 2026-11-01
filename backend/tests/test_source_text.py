import json

import pytest

from app.source_text import source_label
from app.sources.data_gov_resources import SOURCES, parse_resource_payload


@pytest.mark.parametrize('value', [None, '', 'Children’s Centre', 'Café @ 学校', 'Where next?', 'THK Active Ageing Centre @ Kaki Bukit'])
def test_valid_labels_are_preserved(value):
    assert source_label(value) == value


def test_resource_import_cleans_label_and_preserves_original_source_attributes():
    name = 'THK\ufffdActive Ageing Centre\ufffd@ Kaki Bukit'
    source = next(item for item in SOURCES if item.resource_type == 'dementia_gtp')
    payload = json.dumps({'type': 'FeatureCollection', 'features': [{
        'type': 'Feature', 'properties': {'NAME': name},
        'geometry': {'type': 'Point', 'coordinates': [103.8, 1.3]},
    }]}).encode()
    rows, rejected = parse_resource_payload(source, payload)
    assert rejected == 0
    assert rows[0][2]['_source_name'] == 'THK Active Ageing Centre @ Kaki Bukit'
    assert rows[0][2]['NAME'] == name


def test_generated_kml_identifiers_are_not_shown_as_facility_names():
    assert source_label('kml_180') == 'Name unavailable'
    assert source_label(' KML_1 ') == 'Name unavailable'
    assert source_label('KML Clinic') == 'KML Clinic'
