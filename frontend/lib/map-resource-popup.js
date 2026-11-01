import { dengueSeverityColors, resourceLabel } from '@/lib/map-layers';
import { facilityLocationLabel } from '@/lib/geo-cluster';
import { formatDengueTime, NEA_DENGUE_URL } from '@/lib/dengue-status';

function appendLine(root, value, tag = 'p') {
  if (!value) return;
  const element = document.createElement(tag);
  element.textContent = value;
  root.appendChild(element);
}

function appendSafeLink(root, value, label, allowedHost) {
  try {
    const source = new URL(value);
    if (source.protocol !== 'https:' || !allowedHost(source.hostname)) return;
    const link = document.createElement('a');
    link.href = source.href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = label;
    root.appendChild(link);
    return link;
  } catch { /* Source links are optional and treated as untrusted input. */ }
  return null;
}

const isAllowedDataDomain = host => host === 'data.gov.sg' || host.endsWith('.data.gov.sg');
const isAllowedNeaDomain = host => host === 'nea.gov.sg' || host.endsWith('.nea.gov.sg');

export function mapResourcePopupContent(feature, { includeTitle = true } = {}) {
  const properties = feature?.properties || {};
  const type = properties.resourceType;
  const isDengue = type === 'dengue_cluster';
  const root = document.createElement('div');
  if (isDengue) {
    root.className = 'map-dengue-popup';
    if (includeTitle) appendLine(root, properties.name || 'Dengue cluster', 'strong');

    const count = Number.isSafeInteger(properties.caseCount) && properties.caseCount >= 2 ? properties.caseCount : null;
    const facts = document.createElement('div');
    facts.className = 'map-cluster-facts';
    const cases = document.createElement('p');
    cases.className = 'map-cluster-cases';
    cases.textContent = count === null ? 'Cases unavailable' : `${count} cases`;
    facts.appendChild(cases);
    if (count !== null) {
      const alert = document.createElement('span');
      alert.className = 'map-cluster-alert';
      alert.style.color = dengueSeverityColors[count >= 10 ? 'red' : 'yellow'];
      const dot = document.createElement('span');
      dot.className = 'map-cluster-alert-dot';
      dot.setAttribute('aria-hidden', 'true');
      alert.append(dot, document.createTextNode(count >= 10 ? 'Red alert' : 'Yellow alert'));
      facts.appendChild(alert);
    }
    root.appendChild(facts);

    const sourceTime = formatDengueTime(properties.sourceUpdatedAt);
    const updated = document.createElement('p');
    updated.className = 'map-cluster-updated';
    updated.textContent = sourceTime ? `Updated ${sourceTime} SGT` : 'Update date unavailable';
    root.appendChild(updated);

    const footer = document.createElement('div');
    footer.className = 'map-cluster-footer';
    const details = document.createElement('details');
    details.className = 'map-cluster-details';
    appendLine(details, 'Data details', 'summary');
    appendLine(details, count === null ? 'The source did not provide a valid case count.' : count >= 10 ? 'NEA red alert: 10 or more reported cases.' : 'NEA yellow alert: 2 to 9 reported cases.');
    appendLine(details, 'The shaded boundary is an NEA control area, not an estimate of individual infection risk.');
    const recordTime = formatDengueTime(properties.recordUpdatedAt);
    appendLine(details, recordTime ? `Record updated ${recordTime} SGT. This is not a case report date.` : 'Record update date unavailable.');
    appendSafeLink(details, properties.sourceUrl, 'Dataset on data.gov.sg', isAllowedDataDomain);
    footer.appendChild(details);
    const sourceLink = appendSafeLink(footer, NEA_DENGUE_URL, 'NEA ↗', isAllowedNeaDomain);
    sourceLink?.setAttribute('aria-label', 'Open official NEA cluster map');
    root.appendChild(footer);
    return root;
  }
  if (includeTitle) {
    const title = document.createElement('strong');
    title.textContent = properties.name || 'Unnamed facility';
    root.appendChild(title);
  }
  appendLine(root, resourceLabel(type));

  const location = facilityLocationLabel(feature);
  appendLine(root, location);
  appendLine(root, `Source date: ${properties.sourceVersion || 'not reported'}`, 'small');
  appendSafeLink(root, properties.sourceUrl, 'Open official source', isAllowedDataDomain);
  return root;
}
