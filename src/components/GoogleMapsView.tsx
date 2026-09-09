import React, { useState } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation, ExternalLink, Compass } from 'lucide-react';

// Helper component to handle auto-centering when coordinates update
const MapCenterController: React.FC<{ center: { lat: number; lng: number } }> = ({ center }) => {
  const map = useMap();
  React.useEffect(() => {
    if (map) {
      map.panTo(center);
    }
  }, [map, center.lat, center.lng]);
  return null;
};

interface GoogleMapsViewProps {
  latitude?: number;
  longitude?: number;
  title?: string;
  address?: string;
  phone?: string;
  height?: string;
  zoom?: number;
  interactive?: boolean;
  onPositionChange?: (lat: number, lng: number) => void;
  accentColor?: string;
}

const MAPS_API_KEY = String(import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || '').trim();

export const GoogleMapsView: React.FC<GoogleMapsViewProps> = ({
  latitude = 19.076,
  longitude = 72.8777,
  title = 'Nexora Salon & Spa',
  address = 'Linking Road, Santa Cruz West, Mumbai, Maharashtra 400054',
  phone = '+91 98765 43210',
  height = '350px',
  zoom = 15,
  interactive = true,
  onPositionChange,
  accentColor = '#C20E5A',
}) => {
  const [infoOpen, setInfoOpen] = useState<boolean>(true);
  const [markerPos, setMarkerPos] = useState<{ lat: number; lng: number }>({
    lat: latitude,
    lng: longitude,
  });

  // Keep marker position synced if props change
  React.useEffect(() => {
    setMarkerPos({ lat: latitude, lng: longitude });
  }, [latitude, longitude]);

  const handleDragEnd = (e: google.maps.MapMouseEvent) => {
    if (e.latLng && onPositionChange) {
      const newLat = e.latLng.lat();
      const newLng = e.latLng.lng();
      setMarkerPos({ lat: newLat, lng: newLng });
      onPositionChange(newLat, newLng);
    }
  };

  // Clean title & address for optimal Google Maps query
  const cleanAddress = (address || '').trim();
  const cleanTitle = (title || '').trim();

  // Search query: prioritize full business name and address for accurate location matching
  const searchQuery = cleanAddress
    ? (cleanAddress.toLowerCase().includes(cleanTitle.toLowerCase())
        ? cleanAddress
        : `${cleanTitle ? `${cleanTitle}, ` : ''}${cleanAddress}`)
    : (cleanTitle || `${markerPos.lat},${markerPos.lng}`);

  // Maps URL to search & show location directly on Google Maps
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

  // Directions destination: use clean address for high-accuracy local navigation in India
  const isDefaultCoords = Math.abs(markerPos.lat - 19.076) < 0.001 && Math.abs(markerPos.lng - 72.8777) < 0.001;
  const destinationParam = cleanAddress && isDefaultCoords ? searchQuery : `${markerPos.lat},${markerPos.lng}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationParam)}`;

  if (!MAPS_API_KEY) {
    return (
      <div
        style={{ minHeight: height }}
        className="group relative flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center transition-all hover:bg-slate-100/70 hover:border-slate-300"
      >
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-2 text-inherit no-underline group/link cursor-pointer"
          title="Click to view location in Google Maps"
        >
          <div className="w-11 h-11 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shadow-xs group-hover/link:scale-110 group-hover/link:bg-rose-100 transition-all">
            <MapPin aria-hidden="true" className="h-6 w-6" />
          </div>
          <p className="font-semibold text-base text-slate-900 group-hover/link:text-blue-600 transition-colors">
            {title}
          </p>
          <p className="text-sm text-slate-700 max-w-md group-hover/link:text-blue-600 transition-colors flex items-center justify-center gap-1.5 font-medium px-3 py-1 rounded-lg hover:bg-white/80 border border-transparent hover:border-slate-200">
            <span>{address}</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-70 group-hover/link:opacity-100 shrink-0 text-blue-600" />
          </p>
        </a>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 hover:underline-offset-4 transition-all"
            title="Get directions in Google Maps"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Get directions in Google Maps</span>
          </a>
          <span className="text-slate-300">•</span>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 transition-colors"
            title="Open in Google Maps"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open in Maps</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50">
      <APIProvider apiKey={MAPS_API_KEY}>
        <div style={{ height, width: '100%' }} className="relative z-0">
          <Map
            defaultCenter={markerPos}
            center={markerPos}
            defaultZoom={zoom}
            gestureHandling={interactive ? 'greedy' : 'none'}
            disableDefaultUI={!interactive}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            className="w-full h-full"
          >
            <MapCenterController center={markerPos} />
            <AdvancedMarker
              position={markerPos}
              draggable={interactive && !!onPositionChange}
              onDragEnd={handleDragEnd}
              onClick={() => setInfoOpen(true)}
            >
              <Pin
                background={accentColor}
                borderColor="#ffffff"
                glyphColor="#ffffff"
              />
            </AdvancedMarker>

            {infoOpen && (
              <InfoWindow
                position={markerPos}
                onCloseClick={() => setInfoOpen(false)}
              >
                <div className="p-2.5 max-w-[240px] text-slate-900 font-sans">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 mb-1">
                    <MapPin className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>{title}</span>
                  </div>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-slate-700 hover:text-blue-600 hover:underline leading-tight mb-1.5 block font-medium"
                    title="Open address in Google Maps"
                  >
                    {address}
                  </a>
                  <div className="text-[9px] font-mono text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-1 rounded-md mb-2 flex flex-col gap-0.5">
                    <span className="font-bold uppercase text-[8px] text-slate-400">Exact Coordinates</span>
                    <span>Lat: {markerPos.lat.toFixed(6)}</span>
                    <span>Lng: {markerPos.lng.toFixed(6)}</span>
                  </div>
                  {phone && (
                    <p className="text-[10px] text-slate-500 font-mono mb-2">
                      📞 {phone}
                    </p>
                  )}
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-white bg-slate-900 hover:bg-slate-800 px-2 py-1 rounded-md flex items-center gap-1 transition-colors no-underline"
                    >
                      <Navigation className="w-2.5 h-2.5" />
                      <span>Get Directions</span>
                    </a>
                  </div>
                </div>
              </InfoWindow>
            )}
          </Map>

          {/* Quick Action Overlay Bar */}
          <div className="absolute left-3 bottom-3 z-10 flex items-center gap-2 bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-xl border border-slate-200 shadow-md text-xs font-bold text-slate-800">
            <span className="material-symbols-outlined text-rose-600 text-sm">
              location_on
            </span>
            <span className="text-[11px] font-medium text-slate-700 truncate max-w-[180px]">
              {address}
            </span>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-0.5 shrink-0"
            >
              <span>Google Maps</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      </APIProvider>
    </div>
  );
};
