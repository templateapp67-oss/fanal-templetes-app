import React, { useEffect, useRef, useState } from 'react';
import { 
  MapPin, 
  Navigation, 
  Maximize2, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  Compass,
  Check
} from 'lucide-react';
import { SalonProfile } from '../types';
import { GoogleMapsView } from './GoogleMapsView';
import { geocodeAddressWithGoogleMaps } from '../utils/googleGeocoding';
import { GooglePlacesAutocompleteInput, AddressComponents } from './GooglePlacesAutocompleteInput';

interface InteractiveMapSetupProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  themePrimaryColor?: string;
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'
];

export const InteractiveMapSetup: React.FC<InteractiveMapSetupProps> = ({
  profile,
  setProfile,
  themePrimaryColor = '#0f172a'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerInstanceRef = useRef<any>(null);
  const [pinConfirmed, setPinConfirmed] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [pinValidationMsg, setPinValidationMsg] = useState<string>('');
  const [geocodeStatusMsg, setGeocodeStatusMsg] = useState<string>('');

  // Address construct helper
  const constructFullAddress = (
    shop: string,
    locality: string,
    land: string,
    c: string,
    st: string,
    pin: string
  ) => {
    const parts = [];
    if (shop.trim()) parts.push(shop.trim());
    if (locality.trim()) parts.push(locality.trim());
    if (land.trim()) {
      const cleanLand = land.trim().replace(/^near\s+/i, '');
      parts.push(`Near ${cleanLand}`);
    }
    if (c.trim()) parts.push(c.trim());
    if (st.trim()) parts.push(st.trim());
    
    let base = parts.join(', ');
    if (pin.trim()) {
      base += ` - ${pin.trim()}`;
    }
    return base;
  };

  // Local mirror of individual fields with high fidelity fallbacks to match default Mumbai address
  const [shopFlatNo, setShopFlatNo] = useState<string>(profile.shopFlatNo || 'Shop No. 1');
  const [areaLocality, setAreaLocality] = useState<string>(
    profile.areaLocality || 'Linking Road, Santa Cruz West'
  );
  const [city, setCity] = useState<string>(
    profile.city && profile.city !== 'Mumbai, Maharashtra' ? (profile.city.split(',')[0].trim()) : 'Mumbai'
  );
  const [state, setState] = useState<string>(profile.state || 'Maharashtra');
  const [pincode, setPincode] = useState<string>(profile.postalCode || '400054');
  const [landmark, setLandmark] = useState<string>(
    profile.landmark || 'Near Gazebo Shopping'
  );
  const [fullAddress, setFullAddress] = useState<string>(
    profile.address || 'Linking Road, Near Gazebo Shopping, Santa Cruz West, Mumbai, Maharashtra - 400054'
  );

  // Pin check validation
  const isValidPin = pincode.length === 6 && /^\d+$/.test(pincode);

  // Synchronize state back to parent profile on changes
  useEffect(() => {
    setProfile((prev) => ({
      ...prev,
      shopFlatNo,
      areaLocality,
      city,
      state,
      postalCode: pincode,
      landmark,
      address: fullAddress
    }));
  }, [shopFlatNo, areaLocality, city, state, pincode, landmark, fullAddress, setProfile]);

  // Synchronize external changes (like switching templates in the sidebar) into local inputs
  useEffect(() => {
    if (profile && profile.address !== fullAddress) {
      setShopFlatNo(profile.shopFlatNo || '');
      setAreaLocality(profile.areaLocality || '');
      setCity(profile.city && profile.city !== 'Mumbai, Maharashtra' ? (profile.city.split(',')[0].trim()) : 'Mumbai');
      setState(profile.state || 'Maharashtra');
      setPincode(profile.postalCode || '400054');
      setLandmark(profile.landmark || '');
      setFullAddress(profile.address || '');
    }
  }, [profile.address]);

  // Automatically fetch & update salon GPS coordinates using Google Maps Geocoding API whenever fullAddress changes
  useEffect(() => {
    if (!fullAddress || fullAddress.trim().length < 5) return;

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setGeocodeStatusMsg('Fetching coordinates via Google Maps...');
      const result = await geocodeAddressWithGoogleMaps(fullAddress);
      if (result) {
        setProfile((prev) => ({
          ...prev,
          latitude: result.lat,
          longitude: result.lng,
        }));
        setPinConfirmed(true);
        setGeocodeStatusMsg(`Google Maps GPS updated (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)})`);
      } else {
        setGeocodeStatusMsg('Unable to geocode address via Google Maps');
      }
      setIsSearching(false);
    }, 750);

    return () => clearTimeout(timer);
  }, [fullAddress, setProfile]);

  // Load Leaflet dynamically to avoid bundler conflicts
  useEffect(() => {
    const loadLeaflet = async () => {
      if (typeof window === 'undefined') return;

      // Inject Leaflet CSS
      if (!document.getElementById('leaflet-css')) {
        const cssLink = document.createElement('link');
        cssLink.id = 'leaflet-css';
        cssLink.rel = 'stylesheet';
        cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(cssLink);
      }

      // Inject Leaflet JS
      if (!(window as any).L) {
        await new Promise<void>((resolve) => {
          const jsScript = document.createElement('script');
          jsScript.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          jsScript.onload = () => resolve();
          document.body.appendChild(jsScript);
        });
      }

      initializeMap();
    };

    loadLeaflet();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const initializeMap = () => {
    const L = (window as any).L;
    if (!L || !mapContainerRef.current || mapInstanceRef.current) return;

    // Default to Mumbai center if no coordinates
    const lat = profile.latitude || 19.0760;
    const lng = profile.longitude || 72.8777;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false // custom controls rendered in UI
    }).setView([lat, lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Dynamic marker
    const marker = L.marker([lat, lng], {
      draggable: true
    }).addTo(map);

    marker.on('dragend', () => {
      const position = marker.getLatLng();
      setProfile(prev => ({
        ...prev,
        latitude: position.lat,
        longitude: position.lng
      }));
      setPinConfirmed(true);
      
      // Reverse geocode option
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.lat}&lon=${position.lng}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.address) {
            const addr = data.address;
            if (addr.suburb || addr.neighbourhood) {
              setAreaLocality(addr.suburb || addr.neighbourhood || '');
            }
            if (addr.city || addr.town || addr.village) {
              setCity(addr.city || addr.town || addr.village || '');
            }
            if (addr.state) {
              const matchedState = INDIAN_STATES.find(s => s.toLowerCase() === addr.state.toLowerCase());
              if (matchedState) setState(matchedState);
            }
            if (addr.postcode) {
              setPincode(addr.postcode.substring(0, 6));
            }
          }
        })
        .catch(() => {});
    });

    mapInstanceRef.current = map;
    markerInstanceRef.current = marker;
  };

  // Zoom control helpers
  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut();
    }
  };

  // Geocode address via Google Maps Geocoding API
  const handleLocateAddress = async () => {
    const query = fullAddress || `${shopFlatNo} ${areaLocality} ${city} ${state} ${pincode}`;
    if (!query.trim()) return;

    setIsSearching(true);
    setGeocodeStatusMsg('Geocoding address via Google Maps API...');
    try {
      const result = await geocodeAddressWithGoogleMaps(query);
      if (result) {
        setProfile((prev) => ({
          ...prev,
          latitude: result.lat,
          longitude: result.lng,
          shopFlatNo,
          areaLocality,
          city,
          state,
          postalCode: pincode,
          landmark,
          address: fullAddress
        }));
        setPinConfirmed(true);
        setGeocodeStatusMsg(`Google Maps GPS updated (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)})`);
      } else {
        alert('Could not find location coordinates via Google Maps API. Please drag the pin manually.');
        setGeocodeStatusMsg('Geocoding failed');
      }
    } catch (err) {
      console.error(err);
      setGeocodeStatusMsg('Error geocoding address');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-1">
      {/* 1. Business Address Form Section */}
      <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-lg text-slate-500">storefront</span>
            Salon Address & Localization Setup
          </h3>
          <p className="text-[11px] text-slate-500">Add detailed location inputs to guide clients right to your salon doors.</p>
        </div>

        {/* Full Address Multi-line Area with Google Places Autocomplete */}
        <div className="space-y-2">
          <GooglePlacesAutocompleteInput
            value={fullAddress}
            onChange={(val) => setFullAddress(val)}
            latitude={profile.latitude}
            longitude={profile.longitude}
            label="Salon Address (Google Places Autocomplete API)"
            onAddressSelected={(selectedAddr, lat, lng, comps) => {
              setFullAddress(selectedAddr);
              setProfile((prev) => ({
                ...prev,
                address: selectedAddr,
                latitude: lat,
                longitude: lng,
                city: comps?.city || prev.city,
                state: comps?.state || prev.state,
                postalCode: comps?.pincode || prev.postalCode,
              }));
              if (comps?.city) setCity(comps.city);
              if (comps?.state) setState(comps.state);
              if (comps?.pincode) setPincode(comps.pincode);
              setPinConfirmed(true);
            }}
            onCoordinatesUpdate={(lat, lng) => {
              setProfile((prev) => ({
                ...prev,
                latitude: lat,
                longitude: lng,
              }));
              setPinConfirmed(true);
            }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Shop/Flat No. */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Shop / Flat / Suite No.
            </label>
            <input
              type="text"
              value={shopFlatNo}
              onChange={(e) => {
                const val = e.target.value;
                setShopFlatNo(val);
                setFullAddress(constructFullAddress(val, areaLocality, landmark, city, state, pincode));
              }}
              placeholder="e.g. Suite 104, Ground Floor"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* Area/Locality */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Area / Locality / Sector
            </label>
            <input
              type="text"
              value={areaLocality}
              onChange={(e) => {
                const val = e.target.value;
                setAreaLocality(val);
                setFullAddress(constructFullAddress(shopFlatNo, val, landmark, city, state, pincode));
              }}
              placeholder="e.g. Indiranagar Sector 2"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* City */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              City
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => {
                const val = e.target.value;
                setCity(val);
                setFullAddress(constructFullAddress(shopFlatNo, areaLocality, landmark, val, state, pincode));
              }}
              placeholder="Bengaluru"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* State Dropdown */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              State
            </label>
            <select
              value={state}
              onChange={(e) => {
                const val = e.target.value;
                setState(val);
                setFullAddress(constructFullAddress(shopFlatNo, areaLocality, landmark, city, val, pincode));
              }}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
            >
              {INDIAN_STATES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* PIN Code Field */}
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <div className="flex justify-between items-center">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                PIN Code
              </label>
              {isValidPin && (
                <span className="text-[9px] text-emerald-600 font-extrabold flex items-center gap-0.5 animate-fade-in bg-emerald-50 px-1 py-0.2 rounded-md">
                  <Check className="w-2.5 h-2.5" />
                  <span>Valid PIN</span>
                </span>
              )}
            </div>
            <input
              type="text"
              maxLength={6}
              value={pincode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                setPincode(val);
                setFullAddress(constructFullAddress(shopFlatNo, areaLocality, landmark, city, state, val));
              }}
              placeholder="560038"
              className={`w-full p-2.5 bg-slate-50 border rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none ${
                isValidPin ? 'border-emerald-200 focus:border-emerald-500' : 'border-slate-200 focus:border-slate-900'
              }`}
            />
          </div>
        </div>

        {/* Landmark Field */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Landmark <span className="text-slate-400 lowercase italic">(Optional)</span>
          </label>
          <input
            type="text"
            value={landmark}
            onChange={(e) => {
              const val = e.target.value;
              setLandmark(val);
              setFullAddress(constructFullAddress(shopFlatNo, areaLocality, val, city, state, pincode));
            }}
            placeholder="e.g. Behind Metro Station or Near Starbucks"
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={handleLocateAddress}
          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm mt-2"
        >
          <MapPin className="w-4 h-4" />
          <span>Confirm Address & Place Marker Pin</span>
        </button>
      </div>

      {/* 2. Interactive Live Map Preview Section */}
      <div className={`lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between ${isFullscreen ? 'fixed inset-4 z-[999] shadow-2xl' : 'relative'}`}>
        <div className="space-y-3 h-full flex flex-col justify-between">
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-extrabold text-slate-900">Map Live Location</span>
                {pinConfirmed ? (
                  <span className="bg-emerald-100 text-emerald-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Confirmed
                  </span>
                ) : (
                  <span className="bg-amber-100 text-amber-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <AlertTriangle className="w-2.5 h-2.5 animate-bounce" />
                    Needs Location
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                {profile.businessName || 'Pinky Nails'} studio pin on customer map
              </p>
            </div>

            {/* Map Toolbar Buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleLocateAddress}
                title="Refresh Map Coordinates"
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
              >
                <Compass className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title="Toggle Fullscreen Map View"
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Google Maps Container */}
          <div className="relative rounded-2xl overflow-hidden h-[300px] lg:h-full min-h-[280px] flex-1">
            <GoogleMapsView
              latitude={profile.latitude || 19.0760}
              longitude={profile.longitude || 72.8777}
              title={profile.businessName || 'Nexora Salon & Spa'}
              address={fullAddress}
              phone={profile.phone || '+91 98765 43210'}
              height="100%"
              interactive={true}
              onPositionChange={(lat, lng) => {
                setProfile((prev) => ({
                  ...prev,
                  latitude: lat,
                  longitude: lng,
                }));
                setPinConfirmed(true);
              }}
              accentColor={themePrimaryColor}
            />
          </div>

          <p className="text-[10px] text-slate-400 font-medium italic mt-2 text-center">
            "Pin updates automatically as you type your address or drag the marker."
          </p>
        </div>
      </div>
    </div>
  );
};
