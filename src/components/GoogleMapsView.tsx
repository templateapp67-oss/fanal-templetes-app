import React, { useState } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation, ExternalLink, Compass } from 'lucide-react';

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

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${title} ${address}`
  )}`;

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${markerPos.lat},${markerPos.lng}`;

  if (!MAPS_API_KEY) {
    return (
      <div style={{ minHeight: height }} className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
        <MapPin aria-hidden="true" className="h-6 w-6 text-rose-600" />
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-slate-600">{address}</p>
        <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 underline">
          Get directions in Google Maps
        </a>
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
                <div className="p-2 max-w-[220px] text-slate-900 font-sans">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 mb-1">
                    <MapPin className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>{title}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-tight mb-2">
                    {address}
                  </p>
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
