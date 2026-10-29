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
    },
  };
}

export function clusterPointFeatures(features, { cellSize = 0.02 } = {}) {
  if (!Array.isArray(features)) return [];

  const size = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 0.02;
  const buckets = new Map();
  const orderedFeatures = [];

  features.forEach((feature, index) => {
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
