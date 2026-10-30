import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Baby,
  BookOpen,
  Brain,
  Bug,
  GraduationCap,
  HandHeart,
  MapPinned,
  Shapes,
  ShieldCheck,
  Stethoscope,
  Trees,
  UsersRound,
} from 'lucide-react';
import { resourceColors } from '@/lib/map-layers';

export const mapLayerIcons = {
  silver_zone: ShieldCheck,
  dementia_gtp: Brain,
  chas_clinic: Stethoscope,
  eldercare: HandHeart,
  community_club: UsersRound,
  park_facility: Trees,
  childcare: Baby,
  student_care: BookOpen,
  kindergarten: Shapes,
  school_zone: GraduationCap,
  dengue_cluster: Bug,
  moe_school: MapPinned,
};

function layerIconSvg(type, color, size) {
  const LayerIcon = mapLayerIcons[type] || MapPinned;
  return renderToStaticMarkup(createElement(LayerIcon, {
    width: size,
    height: size,
    color,
    strokeWidth: 2,
    'aria-hidden': true,
  }));
}

export function mapLayerMarkerMarkup(type) {
  const color = resourceColors[type] || '#718096';
  const svg = layerIconSvg(type, color, 16);
  return `<span class="map-resource-marker" style="--resource-color:${color}">${svg}</span>`;
}

export function mapLayerClusterMarkup(type, count) {
  const color = resourceColors[type] || '#718096';
  const svg = layerIconSvg(type, color, 20);
  return `<span class="map-resource-cluster" style="--resource-color:${color}"><span class="map-resource-cluster-icon">${svg}</span><span class="map-resource-cluster-count">${count}</span></span>`;
}

export function mapLayerMarkerSvg(type) {
  const color = resourceColors[type] || '#718096';
  const innerSvg = layerIconSvg(type, color, 24)
    .replace(/^<svg\b[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" fill="#ffffff" stroke="${color}" stroke-width="3"/><g transform="translate(16 16)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</g></svg>`;
}
