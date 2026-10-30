const geometryTypes = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

function isPosition(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)
      || typeof value[index] !== 'number'
      || !Number.isFinite(value[index])) return false;
  }
  return value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function everyEntry(values, predicate) {
  if (!Array.isArray(values)) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(values, index) || !predicate(values[index])) return false;
  }
  return true;
}

function isLineString(coordinates) {
  return Array.isArray(coordinates) && coordinates.length >= 2 && everyEntry(coordinates, isPosition);
}

function isLinearRing(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 4 || !everyEntry(coordinates, isPosition)) return false;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isPolygon(coordinates) {
  return Array.isArray(coordinates) && coordinates.length > 0 && everyEntry(coordinates, isLinearRing);
}

function isValidGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object' || !geometryTypes.has(geometry.type)) return false;
  if (geometry.type === 'GeometryCollection') {
    return everyEntry(geometry.geometries, isValidGeometry);
  }
  if (geometry.type === 'Point') return isPosition(geometry.coordinates);
  if (geometry.type === 'MultiPoint') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && everyEntry(geometry.coordinates, isPosition);
  }
  if (geometry.type === 'LineString') return isLineString(geometry.coordinates);
  if (geometry.type === 'MultiLineString') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && everyEntry(geometry.coordinates, isLineString);
  }
  if (geometry.type === 'Polygon') return isPolygon(geometry.coordinates);
  return Array.isArray(geometry.coordinates)
    && geometry.coordinates.length > 0
    && everyEntry(geometry.coordinates, isPolygon);
}

function getMemberId(feature, index) {
  return feature.id ?? feature.properties?.id ?? feature.properties?.sourceId ?? index;
}

const SOURCE_RECORD_FIELDS = [
  'CENTRE_ID', 'CENTRE_CODE', 'HCI_CODE', 'SCHOOL_CODE', 'ENTITYID', 'ID', 'OBJECTID', 'OBJECT_ID',
];
const NEAR_DUPLICATE_METERS = 15;
const DEDUPE_CELL_DEGREES = 0.00015;

function normalizedText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

function sourceAttributes(feature) {
  const attributes = feature?.properties?.attributes;
  if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) return attributes;
  if (typeof attributes === 'string') {
    try {
      const parsed = JSON.parse(attributes);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  return {};
}

function readAttribute(feature, fields) {
  const properties = feature?.properties || {};
  const attributes = sourceAttributes(feature);
  const values = new Map(Object.entries({ ...properties, ...attributes })
    .map(([key, value]) => [key.toUpperCase().replace(/[^A-Z0-9]/g, ''), value]));
  for (const field of fields) {
    const value = values.get(field.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function sourceRecordIdentity(feature) {
  const sourceField = SOURCE_RECORD_FIELDS.find((field) => readAttribute(feature, [field]));
  if (!sourceField) return null;
  const value = normalizedText(readAttribute(feature, [sourceField]));
  if (!value) return null;
  const properties = feature?.properties || {};
  return {
    key: JSON.stringify([properties.resourceType || '', properties.sourceId || '', sourceField, value]),
  };
}

function facilityAddressIdentity(feature) {
  const postal = normalizedText(readAttribute(feature, ['POSTAL_CODE', 'POSTAL_COD', 'POSTAL_CD', 'POSTCODE', 'ZIP']));
  const address = normalizedText(readAttribute(feature, ['ADDRESS', 'FULL_ADDRESS', 'LOCATION']));
  const block = normalizedText(readAttribute(feature, ['BLK_NO', 'BLK_NO_TEXT', 'BLOCK_NO']));
  const street = normalizedText(readAttribute(feature, ['STREET', 'STREET_NAME']));
  const unit = normalizedText(readAttribute(feature, ['UNIT_NO', 'UNIT']));
  const parts = postal
    ? ['postal', postal, unit]
    : address
      ? ['address', address, unit]
      : block || street
        ? ['street', block, street, unit]
        : [];
  return parts.length ? JSON.stringify(parts) : '';
}

export function facilityLocationLabel(feature) {
  const postal = readAttribute(feature, ['POSTAL_CODE', 'POSTAL_COD', 'POSTAL_CD', 'POSTCODE', 'ZIP']);
  const address = readAttribute(feature, ['ADDRESS', 'FULL_ADDRESS', 'LOCATION']);
  const block = readAttribute(feature, ['BLK_NO', 'BLK_NO_TEXT', 'BLOCK_NO']);
  const street = readAttribute(feature, ['STREET', 'STREET_NAME']);
  const unit = readAttribute(feature, ['UNIT_NO', 'UNIT']);
  const base = address || [block, street].filter(Boolean).join(' ');
  const parts = [base, unit && `#${unit}`, postal && `Singapore ${postal}`].filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

function pointDistanceMeters(left, right) {
  const radians = Math.PI / 180;
  const [leftLng, leftLat] = left;
  const [rightLng, rightLat] = right;
  const latDelta = (rightLat - leftLat) * radians;
  const lngDelta = (rightLng - leftLng) * radians;
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(leftLat * radians) * Math.cos(rightLat * radians) * Math.sin(lngDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function hasConflictingIdentity(left, right) {
  return Boolean(left.address && right.address && left.address !== right.address);
}

export function dedupePointFeatures(features) {
  if (!Array.isArray(features)) return [];
  const seenRecordIds = new Set();
  const byAddress = new Map();
  const byNameAndCell = new Map();
  return features.filter((feature) => {
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const rawName = feature?.properties?.name;
    if (!Array.isArray(coordinates) || coordinates.length < 2
      || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])
      || typeof rawName !== 'string' || !rawName.trim()) return true;

    const properties = feature.properties || {};
    const groupKey = JSON.stringify([properties.resourceType || '', normalizedText(rawName)]);
    const record = sourceRecordIdentity(feature);
    const address = facilityAddressIdentity(feature);
    const identity = { feature, record, address, coordinates: coordinates.slice(0, 2) };
    if (record && seenRecordIds.has(record.key)) return false;

    const addressKey = address ? `${groupKey}|${address}` : '';
    const sameAddress = addressKey ? byAddress.get(addressKey) || [] : [];
    if (sameAddress.some((previous) => !hasConflictingIdentity(previous, identity))) return false;

    const gridX = Math.floor(coordinates[0] / DEDUPE_CELL_DEGREES);
    const gridY = Math.floor(coordinates[1] / DEDUPE_CELL_DEGREES);
    const groupCells = byNameAndCell.get(groupKey) || new Map();
    for (let x = gridX - 1; x <= gridX + 1; x += 1) {
      for (let y = gridY - 1; y <= gridY + 1; y += 1) {
        const nearby = groupCells.get(`${x},${y}`) || [];
        if (nearby.some((previous) => !hasConflictingIdentity(previous, identity)
          && pointDistanceMeters(previous.coordinates, identity.coordinates) <= NEAR_DUPLICATE_METERS)) return false;
      }
    }

    if (record) seenRecordIds.add(record.key);
    if (addressKey) byAddress.set(addressKey, [...sameAddress, identity]);
    const cellKey = `${gridX},${gridY}`;
    groupCells.set(cellKey, [...(groupCells.get(cellKey) || []), identity]);
    byNameAndCell.set(groupKey, groupCells);
    return true;
  });
}

function makeCluster(bucket) {
  const representative = bucket.members[0].feature;
  const representativeProperties = representative.properties;
  const properties = representativeProperties && typeof representativeProperties === 'object' && !Array.isArray(representativeProperties)
    ? representativeProperties
    : {};
  const longitude = bucket.members.reduce((total, member) => total + member.coordinates[0], 0) / bucket.members.length;
  const latitude = bucket.members.reduce((total, member) => total + member.coordinates[1], 0) / bucket.members.length;

  return {
    type: 'Feature',
    id: `cluster:${bucket.key}`,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      ...properties,
      cluster: true,
      count: bucket.members.length,
      memberIds: bucket.members.map(({ feature, index }) => getMemberId(feature, index)),
      members: bucket.members.map(({ feature, index }) => ({
        id: getMemberId(feature, index),
        name: typeof feature.properties?.name === 'string' && feature.properties.name.trim()
          ? feature.properties.name.trim()
          : 'Unnamed facility',
        location: facilityLocationLabel(feature),
        coordinates: feature.geometry.coordinates.slice(0, 2),
      })),
    },
  };
}

export function clusterPointFeatures(features, { cellSize = 0.02 } = {}) {
  if (!Array.isArray(features)) return [];

  const size = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 0.02;
  const buckets = new Map();
  const orderedFeatures = [];
  const uniqueFeatures = dedupePointFeatures(features);

  uniqueFeatures.forEach((feature, index) => {
    const geometry = feature?.geometry;
    if (!isValidGeometry(geometry)) return;

    if (geometry.type !== 'Point') {
      orderedFeatures.push({ index, feature });
      return;
    }

    const coordinates = geometry.coordinates;
    const gridX = Math.floor(coordinates[0] / size);
    const gridY = Math.floor(coordinates[1] / size);
    const key = JSON.stringify([feature.properties?.resourceType || '', gridX, gridY]);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, firstIndex: index, members: [] };
      buckets.set(key, bucket);
    }
    bucket.members.push({ feature, index, coordinates });
  });

  const resultItems = [
    ...orderedFeatures,
    ...Array.from(buckets.values(), (bucket) => ({ index: bucket.firstIndex, bucket })),
  ];

  return resultItems
    .sort((left, right) => left.index - right.index)
    .map(({ feature, bucket }) => {
      if (feature) return feature;
      if (bucket.members.length === 1) return bucket.members[0].feature;
      return makeCluster(bucket);
    });
}
