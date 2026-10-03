/** Explicit address search only; never substitutes a guessed city/map pin. */
export async function geocodeOpenStreetMap(address: string) {
 const query=address.trim();
 if (!query) return null;
 const response=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(8000)});
 if (!response.ok) return null;
 const rows=await response.json();
 const row=Array.isArray(rows) ? rows[0] : null;
 if (!row || !['string','number'].includes(typeof row.lat) || !['string','number'].includes(typeof row.lon) || String(row.lat).trim() === '' || String(row.lon).trim() === '') return null;
 const lat=Number(row.lat),lng=Number(row.lon);
 if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return null;
 return {lat,lng,source:'nominatim' as const};
}
