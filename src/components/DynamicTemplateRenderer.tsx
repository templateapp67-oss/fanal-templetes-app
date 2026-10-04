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
  deviceMode?: 'desktop' | 'tablet' | 'mobile';
}

/** All 28 composition recipes live in templateLayouts; sections and actions stay shared. */
const DefaultTemplate: React.FC<DynamicTemplateRendererProps> = ({ config, deviceMode = 'desktop' }) => (
  <SalonWebsitePreview
    profile={config.profile}
    services={config.services}
    stylists={config.stylists ?? []}
    onAddAppointment={(_appointment: Appointment) => undefined}
    selectedTemplateId={config.templateId}
    siteUrl={config.siteUrl}
    publicView
    previewMode
    forcedDeviceMode={deviceMode}
  />
);

export function DynamicTemplateRenderer({ config, activeSection, deviceMode = 'desktop' }: DynamicTemplateRendererProps) {
  return <DefaultTemplate config={config} activeSection={activeSection} deviceMode={deviceMode} />;
}
