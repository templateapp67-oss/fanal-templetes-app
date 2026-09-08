import React, { useEffect, useRef, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Compass, MapPin, CheckCircle2, Sparkles } from 'lucide-react';
import { geocodeAddressWithGoogleMaps } from '../utils/googleGeocoding';

const MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ||
  'AIzaSyD-TEST_DEMO_KEY';

export interface AddressComponents {
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
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
  const placesLib = useMapsLibrary('places');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeMsg, setGeocodeMsg] = useState<string>('');

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
        google.maps.event.removeListener(listener);
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

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full pl-9 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none transition-all ${className}`}
        />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <Compass className="w-4 h-4 text-slate-400" />
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 uppercase tracking-tight">
            Places API
          </span>
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
  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      <AutocompleteInputInner {...props} />
    </APIProvider>
  );
};
