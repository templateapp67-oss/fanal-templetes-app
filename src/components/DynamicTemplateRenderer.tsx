import React from 'react';
import { SalonWebsitePreview } from './SalonWebsitePreview';
import type { Appointment, BusinessTypeId, SalonProfile, SalonService, Stylist } from '../types';

export type TemplatePreviewSection = 'hero' | 'services' | 'gallery' | 'contact' | 'brand' | 'seo' | 'social';

export interface DynamicTemplateConfig {
  templateId: BusinessTypeId;
  profile: SalonProfile;
  services: SalonService[];
  stylists?: Stylist[];
  siteUrl: string;
}

interface DynamicTemplateRendererProps {
  config: DynamicTemplateConfig;
  activeSection: TemplatePreviewSection;
}

/**
 * One renderer for every registered Nexora template. Individual layouts can be
 * added to this map later; the standard renderer already receives the selected
 * template ID plus the exact live editor state, so no template has stale data.
 */
const templateMap: Partial<Record<BusinessTypeId, React.ComponentType<DynamicTemplateRendererProps>>> = {};

const DefaultTemplate: React.FC<DynamicTemplateRendererProps> = ({ config }) => (
  <SalonWebsitePreview
    profile={config.profile}
    services={config.services}
    stylists={config.stylists ?? []}
    onAddAppointment={(_appointment: Appointment) => undefined}
    selectedTemplateId={config.templateId}
    siteUrl={config.siteUrl}
    publicView
    previewMode
    forcedDeviceMode="desktop"
  />
);

export function DynamicTemplateRenderer({ config, activeSection }: DynamicTemplateRendererProps) {
  const TemplateComponent = templateMap[config.templateId] ?? DefaultTemplate;
  return <TemplateComponent config={config} activeSection={activeSection} />;
}
