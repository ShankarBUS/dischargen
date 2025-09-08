// #region ICD-11 Search Handler for Diagnoses

/* ICD-11 remote search (ClinicalTables API) */
/**
 * Remote search using ClinicalTables ICD-11 API.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{code:string, description:string}>>}
 */
async function searchICD11(query, limit = 15, signal = null) {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `https://clinicaltables.nlm.nih.gov/api/icd11_codes/v3/search?sf=code,title&terms=${encodeURIComponent(q)}&maxList=${limit}`;
  try {
    const res = await fetch(url, { signal: signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('ICD-11 search failed');
    const json = await res.json();
    // JSON Format: [total, [codes...], null, [ [code, description, kind], ... ] ]
    if (!Array.isArray(json) || json.length < 4) throw new Error('Unexpected ICD-11 format');
    const data = json[3];
    if (Array.isArray(data)) {
      return data
        .slice(0, limit)
        .map(row => ({ code: row[0], description: row[1] }))
        .filter(r => r.code || r.description);
    }
    return [];
  } catch (e) {
    return [];
  }
}

// In-memory prefix cache to reduce network calls
const icdQueryCache = new Map(); // key: query string -> result array
function icdCacheLookup(q) {
  if (icdQueryCache.has(q)) return icdQueryCache.get(q);
  // try to derive from a shorter prefix to avoid re-filtering client-side (only valid if results length <= limit)
  for (let i = q.length - 1; i >= 1; i--) {
    const prefix = q.slice(0, i);
    if (icdQueryCache.has(prefix)) {
      const arr = icdQueryCache
        .get(prefix)
        .filter(r => (r.code + ' ' + r.description).toLowerCase().includes(q.toLowerCase()));
      icdQueryCache.set(q, arr);
      return arr;
    }
  }
  return null;
}

let abortController = null;
export async function icdSearchWithCache(q) {
  const trimmed = (q || '').trim();
  if (!trimmed) return [];
  const cached = icdCacheLookup(trimmed.toLowerCase());
  if (cached && cached.length > 0) return cached;
  if (abortController) abortController.abort();
  abortController = new AbortController();
  let results = [];
  try {
    results = await searchICD11(trimmed, 15, abortController.signal);
  } catch (e) {
    results = [];
  }
  icdQueryCache.set(trimmed.toLowerCase(), results);
  return results;
}

// #endregion

// #region SNOMED CT Search Handler for Complaints

/* SNOMED CT remote search (Snowstorm API) */
/**
 * Remote search using Snowstorm SNOMED CT API.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{code:string, description:string}>>}
 * */
async function searchSNOMED(query, limit = 15, signal = null) {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `https://snowstorm.ihtsdotools.org/snowstorm/snomed-ct/browser/MAIN/descriptions?term=${encodeURIComponent(q)}&limit=${limit}&offset=0&active=true&semanticTag=finding`;
  try {
    const res = await fetch(url, { signal: signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('SNOMED CT search failed');
    const json = await res.json();
    if (!json || !Array.isArray(json.items)) throw new Error('Unexpected SNOMED CT format');
    return json.items
      .slice(0, limit)
      .map(item =>  item.concept ? (item.concept.pt ? item.concept.pt.term : item.concept.fsn ? item.concept.fsn.term : '') : '')
      .filter(t => t);
  } catch (e) {
    return [];
  }
}

// In-memory prefix cache to reduce network calls
const snomedQueryCache = new Map(); // key: query string -> result array
function snomedCacheLookup(q) {
  if (snomedQueryCache.has(q)) return snomedQueryCache.get(q);
  // try to derive from a shorter prefix to avoid re-filtering client-side (only valid if results length <= limit)
  for (let i = q.length - 1; i >= 1; i--) {
    const prefix = q.slice(0, i);
    if (snomedQueryCache.has(prefix)) {
      const arr = snomedQueryCache
        .get(prefix)
        .filter(r => (r.code + ' ' + r.description).toLowerCase().includes(q.toLowerCase()));
      snomedQueryCache.set(q, arr);
      return arr;
    }
  }
  return null;
}

let abortController1 = null;
export async function snomedSearchWithCache(q) {
  const trimmed = (q || '').trim();
  if (!trimmed) return [];
  const cached = snomedCacheLookup(trimmed.toLowerCase());
  if (cached && cached.length > 0) return cached;
  if (abortController1) abortController1.abort();
  abortController1 = new AbortController();
  let results = [];
  try {
    results = await searchSNOMED(trimmed, 15, abortController1.signal);
  } catch (e) {
    results = [];
  }
  snomedQueryCache.set(trimmed.toLowerCase(), results);
  return results;
}

// #endregion