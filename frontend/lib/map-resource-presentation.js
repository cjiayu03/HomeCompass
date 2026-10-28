import {
  Baby,
  Blocks,
  BookOpen,
  Brain,
  Bug,
  Footprints,
  GraduationCap,
  MapPin,
  School,
  Stethoscope,
} from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const RESOURCE_PRESENTATIONS = {
  silver_zone: {
    label: 'Silver Zone', pluralLabel: 'Silver Zones', color: '#68886c', Icon: Footprints,
    nameFields: ['NAME', 'SILVER_ZONE', 'LOCATION', 'DESCRIPTION'],
  },
  dementia_gtp: {
    label: 'Dementia-friendly point', pluralLabel: 'Dementia-friendly points', color: '#697d91', Icon: Brain,
    nameFields: ['NAME', 'FACILITY_NAME', 'LOCATION', 'DESCRIPTION'],
  },
  chas_clinic: {
    label: 'CHAS clinic', pluralLabel: 'CHAS clinics', unavailableNameLabel: 'Clinic name unavailable', color: '#667a99', Icon: Stethoscope,
    nameFields: ['HCI_NAME', 'NAME', 'CLINIC_NAME'],
  },
  childcare: {
    label: 'Childcare centre', pluralLabel: 'Childcare centres', color: '#8a7898', Icon: Baby,
    nameFields: ['NAME', 'CENTRE_NAME', 'CHILDCARE_NAME'],
  },
  student_care: {
    label: 'Student care centre', pluralLabel: 'Student care centres', color: '#6e8b7c', Icon: BookOpen,
    nameFields: ['NAME', 'CENTRE_NAME', 'STUDENT_CARE_CENTRE', 'NAME_OF_STUDENT_CARE_CENTRE'],
  },
  kindergarten: {
    label: 'Kindergarten', pluralLabel: 'Kindergartens', color: '#627f90', Icon: Blocks,
    nameFields: ['NAME', 'CENTRE_NAME', 'KINDERGARTEN_NAME'],
  },
  moe_school: {
    label: 'School', pluralLabel: 'Schools', color: '#596f88', Icon: School,
    nameFields: ['SCHOOL_NAME', 'SCHOOL', 'NAME'],
  },
  school_zone: {
    label: 'School zone', pluralLabel: 'School zones', color: '#8291a6', Icon: GraduationCap,
    nameFields: ['NAME', 'SCHOOL', 'DESCRIPTION'],
  },
  dengue_cluster: {
    label: 'Active dengue cluster', pluralLabel: 'Active dengue clusters', color: '#b65360', Icon: Bug,
    nameFields: ['LOCALITY', 'NAME', 'CLUSTER_NAME'],
  },
};

const DEFAULT_PRESENTATION = {
  label: 'Nearby point', pluralLabel: 'Nearby points', color: '#718096', Icon: MapPin, nameFields: [],
};

export const MAP_RESOURCE_TYPES = Object.keys(RESOURCE_PRESENTATIONS);

export const MAP_RESOURCE_LAYERS = [
  'silver_zone', 'dementia_gtp', 'chas_clinic', 'childcare', 'student_care',
  'kindergarten', 'school_zone', 'dengue_cluster',
].map((type) => ({ type, ...RESOURCE_PRESENTATIONS[type] }));

export function getResourcePresentation(type) {
  return RESOURCE_PRESENTATIONS[type] || DEFAULT_PRESENTATION;
}

export function getResourceTypeLabel(type) {
  return getResourcePresentation(type).label;
}

export function getResourceTypePluralLabel(type) {
  return getResourcePresentation(type).pluralLabel;
}

function parseAttributes(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeField(value) {
  return String(value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function usableName(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const name = String(value).trim().replace(/\s+/g, ' ');
  if (!name || /^kml[_\s-]*\d+$/i.test(name)) return '';
  return name;
}

export function getResourceDisplayName(properties = {}) {
  const presentation = getResourcePresentation(properties.resourceType);
  const attributes = parseAttributes(properties.attributes);

  for (const field of presentation.nameFields) {
    const entry = Object.entries(attributes).find(([key]) => normalizeField(key) === normalizeField(field));
    const attributeName = usableName(entry?.[1]);
    if (attributeName) return attributeName;
  }

  return usableName(properties.name) || presentation.unavailableNameLabel || presentation.label;
}

export function createResourceMarkerSvg(type) {
  const { color, Icon } = getResourcePresentation(type);
  const iconMarkup = renderToStaticMarkup(createElement(Icon, { width: 20, height: 20, color: '#fff', strokeWidth: 2.5 }));
  const iconContents = iconMarkup.slice(iconMarkup.indexOf('>') + 1, iconMarkup.lastIndexOf('</svg>'));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="88" viewBox="0 0 32 44"><path d="M16 2C8.25 2 2 8.25 2 16c0 9.8 12.2 23.7 14 25.25C17.8 39.7 30 25.8 30 16 30 8.25 23.75 2 16 2Z" fill="${color}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><svg x="6" y="6" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${iconContents}</svg></svg>`;
}

export function resourceMarkerDataUrl(type) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createResourceMarkerSvg(type))}`;
}
