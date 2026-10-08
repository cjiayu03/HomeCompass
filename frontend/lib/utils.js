import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function money(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'No price observation';
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function scoreLabel(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'Not scored';
  return value >= 88 ? 'Strong fit' : value >= 80 ? 'Worth a closer look' : 'Trade-off candidate';
}

export function parseDistance(value) {
  const match = String(value).match(/[\d.]+/);
  if (!match) return null;
  return value.includes('km') ? Number(match[0]) * 1000 : Number(match[0]);
}
