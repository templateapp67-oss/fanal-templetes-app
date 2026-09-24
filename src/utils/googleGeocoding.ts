export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress?: string;
  source: 'google_js_sdk' | 'google_api' | 'server_api' | 'fallback';
}

const MAPS_API_KEY = String(
  import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || ''
).trim();

const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  mumbai: { lat: 19.076, lng: 72.8777 },
  delhi: { lat: 28.6139, lng: 77.209 },
  'new delhi': { lat: 28.6139, lng: 77.209 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  pune: { lat: 18.5204, lng: 73.8567 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  surat: { lat: 21.1702, lng: 72.8311 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  chandigarh: { lat: 30.7333, lng: 76.7794 },
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  noida: { lat: 28.5355, lng: 77.391 },
  kochi: { lat: 9.9312, lng: 76.2673 },
  indore: { lat: 22.7196, lng: 75.8577 },
  nagpur: { lat: 21.1458, lng: 79.0882 },
  goa: { lat: 15.4909, lng: 73.8278 },
  panaji: { lat: 15.4909, lng: 73.8278 },
};

/**
 * Automatically fetches GPS coordinates (latitude, longitude) for a given address.
 * Tries server-side API proxy first, then Google Maps JS SDK, HTTP API, and Nominatim fallback.
 */
export async function geocodeAddressWithGoogleMaps(
  address: string
): Promise<GeocodeResult | null> {
  if (!address || !address.trim()) return null;

  const cleanAddress = address.trim();

  // 1. Primary: Try server proxy endpoint (/api/geocode)
  try {
    const serverRes = await fetch(`/api/geocode?address=${encodeURIComponent(cleanAddress)}`);
    if (serverRes.ok) {
      const serverData = await serverRes.json();
      if (serverData && serverData.success && typeof serverData.lat === 'number' && typeof serverData.lng === 'number') {
        return {
          lat: serverData.lat,
          lng: serverData.lng,
          formattedAddress: serverData.formattedAddress || cleanAddress,
          source: 'server_api',
        };
      }
    }
  } catch (e) {
    console.warn('Server geocode endpoint unavailable, trying client-side fallback:', e);
  }

  // 2. Secondary: Use Google Maps JS SDK Geocoder if loaded in the DOM
  if (
    typeof window !== 'undefined' &&
    (window as any).google &&
    (window as any).google.maps &&
    (window as any).google.maps.Geocoder
  ) {
    try {
      const geocoder = new (window as any).google.maps.Geocoder();
      const response = await new Promise<any>((resolve) => {
        geocoder.geocode({ address: cleanAddress }, (results: any, status: string) => {
          if (status === 'OK' && results && results[0]) {
            resolve(results[0]);
          } else {
            resolve(null);
          }
        });
      });

      if (response && response.geometry && response.geometry.location) {
        const loc = response.geometry.location;
        const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
        const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
        return {
          lat,
          lng,
          formattedAddress: response.formatted_address,
          source: 'google_js_sdk',
        };
      }
    } catch (e) {
      console.warn('Google Maps JS Geocoder failed, trying HTTP API fallback:', e);
    }
  }

  // 3. Direct fetch to Google Maps Geocoding REST API (if key present)
  if (MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        cleanAddress
      )}&key=${MAPS_API_KEY}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return {
          lat: location.lat,
          lng: location.lng,
          formattedAddress: data.results[0].formatted_address,
          source: 'google_api',
        };
      }
    } catch (err) {
      console.warn('Google Maps HTTP Geocoding API call encountered issue:', err);
    }
  }

  // 4. OpenStreetMap Nominatim for dev/demo fallback
  try {
    const fallbackRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
        cleanAddress
      )}`
    );
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData && fallbackData.length > 0) {
        return {
          lat: parseFloat(fallbackData[0].lat),
          lng: parseFloat(fallbackData[0].lon),
          formattedAddress: fallbackData[0].display_name,
          source: 'fallback',
        };
      }
    }
  } catch (err) {
    console.warn('Client-side Nominatim fetch failed:', err);
  }

  // 5. Local city matching fallback
  const lower = cleanAddress.toLowerCase();
  for (const [city, coords] of Object.entries(CITY_COORDINATES)) {
    if (lower.includes(city)) {
      return {
        lat: coords.lat,
        lng: coords.lng,
        formattedAddress: cleanAddress,
        source: 'fallback',
      };
    }
  }

  // 6. Default Mumbai location fallback
  return {
    lat: 19.076,
    lng: 72.8777,
    formattedAddress: cleanAddress,
    source: 'fallback',
  };
}

/**
 * Reverse-geocodes GPS coordinates (latitude, longitude) into a physical address.
 */
export async function reverseGeocodeWithGoogleMaps(
  lat: number,
  lng: number
): Promise<string | null> {
  // 1. Primary: Use Google Maps JS SDK Geocoder if loaded in the DOM
  if (
    typeof window !== 'undefined' &&
    (window as any).google &&
    (window as any).google.maps &&
    (window as any).google.maps.Geocoder
  ) {
    try {
      const geocoder = new (window as any).google.maps.Geocoder();
      const response = await new Promise<any>((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results: any, status: string) => {
          if (status === 'OK' && results && results[0]) {
            resolve(results[0]);
          } else {
            resolve(null);
          }
        });
      });

      if (response && response.formatted_address) {
        return response.formatted_address;
      }
    } catch (e) {
      console.warn('Google Maps JS Reverse Geocoder failed:', e);
    }
  }

  // 2. Direct fetch to Google Maps Geocoding REST API (if key present)
  if (MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${MAPS_API_KEY}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        return data.results[0].formatted_address;
      }
    } catch (err) {
      console.warn('Google Maps HTTP Reverse Geocoding API call encountered issue:', err);
    }
  }

  // 3. Fallback: OpenStreetMap Nominatim for dev/demo fallback
  try {
    const fallbackRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
    );
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData && fallbackData.display_name) {
        return fallbackData.display_name;
      }
    }
  } catch (err) {
    console.warn('Client-side Nominatim reverse geocode failed:', err);
  }

  return 'Mumbai, Maharashtra, India';
}
