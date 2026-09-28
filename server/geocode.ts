import { Request, Response } from 'express';

export async function handleGeocodeRequest(req: Request, res: Response) {
  const address = String(req.query.address || '').trim();
  if (!address || address.length > 1000) {
    return res.status(400).json({ success: false, error: 'Address parameter is required' });
  }

  const apiKey = String(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();

  // 1. Try Google Maps API server-side
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
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
      signal: AbortSignal.timeout(3500),
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

  // An unverified city-centre/Mumbai pin is not the customer's salon.
  // The browser can still embed Google Maps using the saved address itself.
  return res.status(422).json({ success: false, error: 'An exact location could not be verified. Use the saved address on the map.' });
}
