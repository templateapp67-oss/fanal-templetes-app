import React, { useState } from 'react';
import { CategoryTemplateConfig } from '../types';

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: CategoryTemplateConfig & { categoryName?: string };
  onSelect: (templateId: string) => void;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  isOpen,
  onClose,
  template,
  onSelect,
}) => {
  const [deviceView, setDeviceView] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  if (!isOpen || !template) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center overflow-x-hidden p-2 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-4xl max-h-[96dvh] sm:max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200/80">
        {/* Header bar */}
        <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-slate-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-slate-50/80">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              onClick={onClose}
              className="flex min-h-11 shrink-0 items-center gap-1.5 py-2 px-3 rounded-xl border border-slate-300 hover:bg-white text-xs font-bold text-slate-700 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              <span>Back to Templates</span>
            </button>
            <span className="min-w-0 truncate px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-extrabold uppercase tracking-wider border border-emerald-200">
              {template.categoryName || template.paletteLabel || 'Template Preview'}
            </span>
          </div>

          {/* Desktop / tablet / mobile preview toggle. The frame widths are
              capped, never scaled beyond the available mobile viewport. */}
          <div className="grid w-full grid-cols-3 items-center gap-1 bg-slate-200/80 p-1 rounded-xl sm:w-auto">
            <button
              onClick={() => setDeviceView('desktop')}
              className={`min-h-10 flex items-center justify-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                deviceView === 'desktop'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Desktop View"
            >
              <span className="material-symbols-outlined text-base">laptop</span>
              <span className="hidden sm:inline">Desktop</span>
            </button>
            <button
              onClick={() => setDeviceView('tablet')}
              className={`min-h-10 flex items-center justify-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                deviceView === 'tablet'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Tablet View"
            >
              <span className="material-symbols-outlined text-base">tablet_mac</span>
              <span className="hidden sm:inline">Tablet</span>
            </button>
            <button
              onClick={() => setDeviceView('mobile')}
              className={`min-h-10 flex items-center justify-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                deviceView === 'mobile'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Mobile View"
            >
              <span className="material-symbols-outlined text-base">smartphone</span>
              <span className="hidden sm:inline">Mobile</span>
            </button>
          </div>
        </div>

        {/* Visual Preview Container */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 bg-slate-100 flex flex-col items-center">
          <div
            className={`transition-all duration-300 w-full bg-white rounded-2xl overflow-hidden shadow-lg border border-slate-300/80 ${
              deviceView === 'mobile' ? 'max-w-[375px]' : deviceView === 'tablet' ? 'max-w-[768px]' : 'max-w-full'
            }`}
          >
            {/* Browser / Phone Chrome Header */}
            <div className="bg-slate-900 text-slate-300 px-4 py-2.5 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              </div>
              <div className="truncate max-w-[200px] text-[11px] opacity-75">
                {template.id}.nexora.in
              </div>
              <div className="text-[10px] text-emerald-400 font-bold">● LIVE DEMO</div>
            </div>

            {/* Template Hero Image Banner */}
            <div className="relative aspect-[16/9] w-full bg-slate-950 overflow-hidden">
              <img
                src={template.coverImageUrl}
                alt={template.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent flex flex-col justify-end p-4 sm:p-6 text-white">
                <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-1">
                  {template.paletteLabel || 'Luxury Collection'}
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold font-display leading-tight">
                  {template.title}
                </h2>
                <p className="text-xs sm:text-sm text-slate-200 line-clamp-2 mt-1 font-light">
                  {template.tagline}
                </p>
              </div>
            </div>

            {/* Demo Content Showcase */}
            <div className="p-4 sm:p-6 space-y-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  About This Salon Experience
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                  {template.about}
                </p>
              </div>

              {/* Sample Services Pill List */}
              {template.services && template.services.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Signature Services Included ({template.services.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {template.services.slice(0, 4).map((s: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs"
                      >
                        <span className="font-bold text-slate-800 truncate mr-2">{s.name}</span>
                        <span className="font-bold text-emerald-700 whitespace-nowrap">
                          ₹{s.price}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 sm:px-6 bg-white border-t border-slate-200 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={onClose}
            className="min-h-11 w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSelect(template.id);
            }}
            className="min-h-11 w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Select This Template</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
