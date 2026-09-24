import { Request, Response } from 'express';

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
  cochin: { lat: 9.9312, lng: 76.2673 },
  indore: { lat: 22.7196, lng: 75.8577 },
  nagpur: { lat: 21.1458, lng: 79.0882 },
  goa: { lat: 15.4909, lng: 73.8278 },
  panaji: { lat: 15.4909, lng: 73.8278 },
  vadodara: { lat: 22.3094, lng: 73.1812 },
  coimbatore: { lat: 11.0168, lng: 76.9558 },
  bhopal: { lat: 23.2599, lng: 77.4126 },
  visakhapatnam: { lat: 17.6868, lng: 83.2185 },
  patna: { lat: 25.5941, lng: 85.1376 },
  bhubaneswar: { lat: 20.2961, lng: 85.8245 },
  dehradun: { lat: 30.3165, lng: 78.0322 },
  guwahati: { lat: 26.1445, lng: 91.7362 },
};

function matchCityCoordinates(address: string): { lat: number; lng: number } | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const [city, coords] of Object.entries(CITY_COORDINATES)) {
    if (lower.includes(city)) {
      return coords;
    }
  }
  return null;
}

export async function handleGeocodeRequest(req: Request, res: Response) {
  const address = String(req.query.address || '').trim();
  if (!address) {
    return res.status(400).json({ success: false, error: 'Address parameter is required' });
  }

  const apiKey = String(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();

  // 1. Try Google Maps API server-side
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return res.json({
          success: true,
          lat: location.lat,
          lng: location.lng,
          formattedAddress: data.results[0].formatted_address,
          source: 'google_api',
        });
      }
    } catch (err) {
      console.warn('[Geocode Server] Google Maps API fetch failed:', err);
    }
  }

  // 2. Try Nominatim server-side (server fetch has no CORS restrictions)
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NexoraSalonApp/1.0 (contact@nexora.app)',
      },
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return res.json({
          success: true,
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          formattedAddress: data[0].display_name,
          source: 'nominatim',
        });
      }
    }
  } catch (err) {
    console.warn('[Geocode Server] Nominatim fetch failed:', err);
  }

  // 3. Smart city coordinate lookup fallback
  const cityMatch = matchCityCoordinates(address);
  if (cityMatch) {
    return res.json({
      success: true,
      lat: cityMatch.lat,
      lng: cityMatch.lng,
      formattedAddress: address,
      source: 'city_fallback',
    });
  }

  // 4. Default Mumbai location fallback
  return res.json({
    success: true,
    lat: 19.076,
    lng: 72.8777,
    formattedAddress: address || 'Mumbai, Maharashtra, India',
    source: 'default_fallback',
  });
}
