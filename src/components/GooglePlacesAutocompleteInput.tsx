import React, { useEffect, useRef, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Compass, MapPin, CheckCircle2, Sparkles, RotateCw, Locate } from 'lucide-react';
import { geocodeAddressWithGoogleMaps, reverseGeocodeWithGoogleMaps } from '../utils/googleGeocoding';

const MAPS_API_KEY = String(
  import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || ''
).trim();

export interface AddressComponents {
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  area?: string;
}

interface GooglePlacesAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelected?: (
    address: string,
    lat: number,
    lng: number,
    components?: AddressComponents
  ) => void;
  onCoordinatesUpdate?: (lat: number, lng: number) => void;
  placeholder?: string;
  className?: string;
  latitude?: number;
  longitude?: number;
  label?: string;
}

const AutocompleteInputInner: React.FC<GooglePlacesAutocompleteInputProps> = ({
  value,
  onChange,
  onAddressSelected,
  onCoordinatesUpdate,
  placeholder = 'Start typing salon address (e.g. Shop 5, Indiranagar, Bengaluru)...',
  className = '',
  latitude,
  longitude,
  label = 'Full Business Address (Google Places Autocomplete)',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  let placesLib: any = null;
  try {
    placesLib = useMapsLibrary('places');
  } catch (e) {
    // Graceful fallback when APIProvider is not present
  }

  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geocodeMsg, setGeocodeMsg] = useState<string>('');

  const handleUseCurrentLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGeocodeMsg('Geolocation is not supported by your browser');
      return;
    }

    setIsLocating(true);
    setGeocodeMsg('Requesting browser GPS coordinates...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        setGeocodeMsg(`Location fetched: (${lat.toFixed(6)}, ${lng.toFixed(6)}). Reverse-geocoding...`);

        try {
          const address = await reverseGeocodeWithGoogleMaps(lat, lng);
          if (address) {
            onChange(address);
            if (onCoordinatesUpdate) {
              onCoordinatesUpdate(lat, lng);
            }
            if (onAddressSelected) {
              onAddressSelected(address, lat, lng);
            }
            setGeocodeMsg(`Location updated successfully to: "${address}"`);
          } else {
            // Update coordinates even if reverse geocode fails
            if (onCoordinatesUpdate) {
              onCoordinatesUpdate(lat, lng);
            }
            setGeocodeMsg(`Coordinates set: (${lat.toFixed(4)}, ${lng.toFixed(4)}), but could not resolve address string.`);
          }
        } catch (err) {
          console.error('Reverse geocoding error:', err);
          if (onCoordinatesUpdate) {
            onCoordinatesUpdate(lat, lng);
          }
          setGeocodeMsg(`Coordinates set: (${lat.toFixed(4)}, ${lng.toFixed(4)}). Reverse geocoding failed.`);
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.warn('Geolocation error:', error);
        let errorMsg = 'Could not access location.';
        if (error.code === 1) {
          errorMsg = 'Location permission denied. Please allow location access in your browser.';
        } else if (error.code === 2) {
          errorMsg = 'Location unavailable or network timed out.';
        }
        setGeocodeMsg(errorMsg);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleManualGeocode = async () => {
    if (!value || !value.trim()) {
      setGeocodeMsg('Please enter an address first to fetch coordinates');
      return;
    }
    setIsGeocoding(true);
    setGeocodeMsg('Re-triggering Geocoding API for address...');

    const geocodeResult = await geocodeAddressWithGoogleMaps(value);

    if (geocodeResult) {
      const { lat, lng } = geocodeResult;
      if (onCoordinatesUpdate) {
        onCoordinatesUpdate(lat, lng);
      }
      if (onAddressSelected) {
        onAddressSelected(value, lat, lng);
      }
      setGeocodeMsg(
        `Coordinates updated (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      );
    } else {
      setGeocodeMsg('Could not resolve coordinates for address');
    }
    setIsGeocoding(false);
  };

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;

    try {
      const autocomplete = new placesLib.Autocomplete(inputRef.current, {
        fields: ['formatted_address', 'geometry', 'name', 'address_components'],
      });

      const listener = autocomplete.addListener('place_changed', async () => {
        const place = autocomplete.getPlace();
        const selectedAddress =
          place.formatted_address || place.name || inputRef.current?.value || '';

        if (!selectedAddress) return;

        onChange(selectedAddress);
        setIsGeocoding(true);
        setGeocodeMsg('Triggering Google Maps Geocoding API...');

        // Extract address components if available
        const parsedComponents: AddressComponents = {};
        if (place.address_components) {
          for (const comp of place.address_components) {
            if (comp.types.includes('locality')) {
              parsedComponents.city = comp.long_name;
            } else if (comp.types.includes('administrative_area_level_1')) {
              parsedComponents.state = comp.long_name;
            } else if (comp.types.includes('postal_code')) {
              parsedComponents.pincode = comp.long_name;
            } else if (comp.types.includes('sublocality_level_1') || comp.types.includes('sublocality')) {
              parsedComponents.area = comp.long_name;
            } else if (comp.types.includes('country')) {
              parsedComponents.country = comp.long_name;
            }
          }
        }

        // Trigger Geocoding API to fetch and update exact coordinates
        let lat: number | null = null;
        let lng: number | null = null;

        const geocodeResult = await geocodeAddressWithGoogleMaps(selectedAddress);

        if (geocodeResult) {
          lat = geocodeResult.lat;
          lng = geocodeResult.lng;
        } else if (place.geometry?.location) {
          lat =
            typeof place.geometry.location.lat === 'function'
              ? place.geometry.location.lat()
              : (place.geometry.location.lat as any);
          lng =
            typeof place.geometry.location.lng === 'function'
              ? place.geometry.location.lng()
              : (place.geometry.location.lng as any);
        }

        if (lat !== null && lng !== null) {
          if (onCoordinatesUpdate) {
            onCoordinatesUpdate(lat, lng);
          }
          if (onAddressSelected) {
            onAddressSelected(selectedAddress, lat, lng, parsedComponents);
          }
          setGeocodeMsg(
            `Geocoded via Google Maps: (${lat.toFixed(4)}, ${lng.toFixed(4)})`
          );
        } else {
          setGeocodeMsg('Could not resolve coordinates for address');
        }

        setIsGeocoding(false);
      });

      return () => {
        if (typeof google !== 'undefined' && google.maps && google.maps.event) {
          google.maps.event.removeListener(listener);
        }
      };
    } catch (err) {
      console.warn('Google Places Autocomplete initialization warning:', err);
    }
  }, [placesLib, onChange, onCoordinatesUpdate, onAddressSelected]);

  return (
    <div className="space-y-1.5 w-full">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
          <MapPin className="w-3 h-3 text-rose-500" />
          <span>{label}</span>
        </label>
        {isGeocoding ? (
          <span className="text-[10px] text-amber-600 font-bold flex items-center gap-1 animate-pulse">
            <Compass className="w-3 h-3 animate-spin" />
            <span>Geocoding via Google Maps API...</span>
          </span>
        ) : latitude && longitude ? (
          <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-mono font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>
              GPS ({latitude.toFixed(4)}, {longitude.toFixed(4)})
            </span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`w-full pl-9 pr-16 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none transition-all ${className}`}
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Compass className="w-4 h-4 text-slate-400" />
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 uppercase tracking-tight">
              {MAPS_API_KEY ? 'Places API' : 'Address'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={isLocating || isGeocoding}
            title="Fetch user's current GPS coordinates and reverse-geocode them"
            className="flex-1 sm:flex-initial px-3 py-2.5 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 disabled:opacity-50 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-rose-200/50 shadow-xs"
          >
            <Locate className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin text-rose-600' : 'text-rose-500'}`} />
            <span>Use Current Location</span>
          </button>

          <button
            type="button"
            onClick={handleManualGeocode}
            disabled={isGeocoding || isLocating || !value?.trim()}
            title="Refresh Coordinates (Manually re-trigger Geocoding API)"
            className="flex-1 sm:flex-initial px-3 py-2.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white disabled:opacity-50 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isGeocoding ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {geocodeMsg && (
        <div className="text-[10px] text-slate-500 font-medium flex items-center gap-1 pl-1">
          <Sparkles className="w-3 h-3 text-amber-500" />
          <span>{geocodeMsg}</span>
        </div>
      )}
    </div>
  );
};

export const GooglePlacesAutocompleteInput: React.FC<
  GooglePlacesAutocompleteInputProps
> = (props) => {
  if (!MAPS_API_KEY) {
    return <AutocompleteInputInner {...props} />;
  }

  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      <AutocompleteInputInner {...props} />
    </APIProvider>
  );
};
