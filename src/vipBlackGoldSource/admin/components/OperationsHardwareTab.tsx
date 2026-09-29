import React, { useState } from 'react';
import {
  QrActivation,
  ProductItem,
  VendorDealer,
  InvoiceRecord,
  DispatchRecord,
  VehicleRecord,
} from '../types';
import { QrCode, Package, Truck, Car, FileCheck, Check, X, Upload, Shield, AlertCircle } from 'lucide-react';

interface OperationsHardwareTabProps {
  qrTerminals: QrActivation[];
  products: ProductItem[];
  vendors: VendorDealer[];
  invoices: InvoiceRecord[];
  dispatches: DispatchRecord[];
  vehicles: VehicleRecord[];
  onRequestAudit: (
    entityType: string,
    entityName: string,
    fieldChanged: string,
    oldValue: string,
    proposedNewValue: string,
    onConfirmed: (reason: string, finalAdmin: string, finalVal: string) => void,
    allowEditNewVal?: boolean
  ) => void;
  onUpdateQrStatus: (id: string, status: 'active' | 'frozen') => void;
  onUpdateProductStock: (id: string, newStock: number) => void;
  onUpdateDispatchStatus: (id: string, status: 'out_for_delivery' | 'delivered') => void;
  onUpdateVehicleInspection: (id: string, status: 'certified' | 'pending_audit') => void;
  onUploadInvoice: (invoice: InvoiceRecord) => void;
}

export const OperationsHardwareTab: React.FC<OperationsHardwareTabProps> = ({
  qrTerminals,
  products,
  vendors,
  invoices,
  dispatches,
  vehicles,
  onRequestAudit,
  onUpdateQrStatus,
  onUpdateProductStock,
  onUpdateDispatchStatus,
  onUpdateVehicleInspection,
  onUploadInvoice,
}) => {
  const [subView, setSubView] = useState<'qr' | 'products' | 'vendors' | 'invoices' | 'dispatches' | 'vehicles'>('qr');
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [mockInvoiceName, setMockInvoiceName] = useState<string>('INV-2026-SEP-NEW.pdf');
  const [mockInvoiceParty, setMockInvoiceParty] = useState<string>("L'Étoile Hair Lounge");
  const [mockInvoiceAmount, setMockInvoiceAmount] = useState<number>(25000);

  return (
    <div className="space-y-6">
      {/* Sub navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[#D4AF37]/20 pb-3">
        <button
          onClick={() => setSubView('qr')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'qr'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          4. QR Activation & Hardware
        </button>
        <button
          onClick={() => setSubView('products')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'products'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          13. Product Catalogue
        </button>
        <button
          onClick={() => setSubView('vendors')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'vendors'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          14. Vendor & Dealers
        </button>
        <button
          onClick={() => setSubView('invoices')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'invoices'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          15. Invoice Upload & Audits
        </button>
        <button
          onClick={() => setSubView('dispatches')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'dispatches'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          17. Dispatch Tracking
        </button>
        <button
          onClick={() => setSubView('vehicles')}
          className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-all ${
            subView === 'vehicles'
              ? 'bg-[#D4AF37] text-black font-semibold'
              : 'bg-[#111111] text-gray-300 hover:text-white border border-white/10'
          }`}
        >
          18. Vehicle Registration Records
        </button>
      </div>

      {/* 4. QR ACTIVATION */}
      {subView === 'qr' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">QR Terminal Activation & Security Controls</h3>
              <p className="text-xs font-mono text-gray-400">Desk terminal provisioning, telemetry heartbeat & emergency freeze</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {qrTerminals.map((qr) => (
              <div key={qr.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/30 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-mono text-[#D4AF37] block">{qr.terminalCode}</span>
                    <h4 className="text-sm font-medium text-white">{qr.salonName}</h4>
                    <p className="text-xs text-gray-400">{qr.deskNumber}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      qr.status === 'active'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-red-950 text-red-300 border border-red-500/40'
                    }`}
                  >
                    {qr.status}
                  </span>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 font-mono text-xs space-y-1">
                  <div className="flex justify-between text-gray-400">
                    <span>UPI VPA Link:</span>
                    <span className="text-white">{qr.upiVpa}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Hardware Spec:</span>
                    <span className="text-[#D4AF37]">{qr.hardwareModel}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Last Telemetry:</span>
                    <span className="text-emerald-400">{qr.lastPing}</span>
                  </div>
                </div>

                <div className="flex justify-end items-center space-x-2 pt-2 border-t border-white/10">
                  {qr.status === 'inactive' || qr.status === 'frozen' ? (
                    <button
                      onClick={() =>
                        onRequestAudit(
                          'QR Terminal',
                          `${qr.salonName} (${qr.terminalCode})`,
                          'Terminal Status',
                          qr.status,
                          'active',
                          () => onUpdateQrStatus(qr.id, 'active')
                        )
                      }
                      className="px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono"
                    >
                      Activate Terminal
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        onRequestAudit(
                          'QR Terminal',
                          `${qr.salonName} (${qr.terminalCode})`,
                          'Terminal Status',
                          qr.status,
                          'frozen',
                          () => onUpdateQrStatus(qr.id, 'frozen')
                        )
                      }
                      className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded text-[10px] font-mono"
                    >
                      Freeze QR (Emergency)
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 13. PRODUCT CATALOGUE */}
      {subView === 'products' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Product Catalogue & Inventory Management</h3>
              <p className="text-xs font-mono text-gray-400">Exclusive luxury back-bar supplies, serums & bespoke formulations</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">SKU & Item Name</th>
                  <th className="p-3">Brand / Atelier</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Luxury Grade</th>
                  <th className="p-3">B2B Price</th>
                  <th className="p-3">Stock Units</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Manual Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {products.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02]">
                    <td className="p-3">
                      <div className="font-medium text-white">{item.name}</div>
                      <div className="text-[10px] font-mono text-[#D4AF37]">{item.sku}</div>
                    </td>
                    <td className="p-3 text-gray-300">{item.brand}</td>
                    <td className="p-3 text-gray-400 font-mono">{item.category}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 border border-[#D4AF37]/30 text-[#D4AF37]">
                        {item.luxuryGrade}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-medium text-white">₹{item.price.toLocaleString()}</td>
                    <td className="p-3 font-mono text-emerald-400 font-semibold">{item.stockUnits} units</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          item.status === 'in_stock'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {item.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => {
                          const newStock = item.stockUnits + 20;
                          onRequestAudit(
                            'Product Catalogue',
                            item.name,
                            'Stock Units',
                            `${item.stockUnits} units`,
                            `${newStock} units`,
                            () => onUpdateProductStock(item.id, newStock)
                          );
                        }}
                        className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/20 rounded text-[10px] font-mono"
                      >
                        +20 Restock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 14. VENDORS & DEALERS */}
      {subView === 'vendors' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Vendor & Luxury Dealer Management</h3>
              <p className="text-xs font-mono text-gray-400">Global sourcing contracts, Swiss & French SLA compliance</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {vendors.map((v) => (
              <div key={v.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/25 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-medium text-white">{v.vendorName}</h4>
                    <p className="text-xs text-[#D4AF37] font-mono">{v.category}</p>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                    ★ {v.rating}
                  </span>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 text-xs font-mono space-y-1">
                  <p className="text-gray-300">Contact: {v.contactPerson}</p>
                  <p className="text-gray-400">{v.contactPhone}</p>
                  <p className="text-[10px] text-gray-500">Contract End: {v.contractExpiry}</p>
                  <p className="text-[10px] text-gray-400 italic mt-1 border-t border-white/5 pt-1">
                    SLA: {v.slaTerms}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 15. INVOICE UPLOAD & AUDIT */}
      {subView === 'invoices' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Invoice Upload & Tax Records</h3>
              <p className="text-xs font-mono text-gray-400">GST-compliant tax invoices for platform commission and terminal kits</p>
            </div>
            <button
              onClick={() => setShowUploadModal(true)}
              className="metallic-button-strong px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> Upload Tax Invoice
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">Invoice Number</th>
                  <th className="p-3">Billing Salon / Vendor</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Gross Amount</th>
                  <th className="p-3">GST (18%)</th>
                  <th className="p-3">Attachment</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-mono font-medium text-[#D4AF37]">{inv.invoiceNumber}</td>
                    <td className="p-3 text-white">{inv.salonOrVendor}</td>
                    <td className="p-3 font-mono text-xs text-gray-400">{inv.invoiceDate}</td>
                    <td className="p-3 font-mono text-xs text-gray-300">{inv.type}</td>
                    <td className="p-3 font-mono font-semibold text-white">₹{inv.grossAmount.toLocaleString()}</td>
                    <td className="p-3 font-mono text-gray-400">₹{inv.gstAmount.toLocaleString()}</td>
                    <td className="p-3 font-mono text-[11px] text-blue-400 underline">{inv.fileAttachment}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          inv.status === 'verified'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Simple upload drawer/dialog */}
          {showUploadModal && (
            <div className="p-4 bg-[#0A0A0A] rounded-lg border border-[#D4AF37]/40 space-y-3">
              <h4 className="text-xs font-mono text-white uppercase tracking-wider">New GST Tax Invoice Upload</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-gray-400 block mb-1">Billing Salon / Vendor</label>
                  <input
                    type="text"
                    value={mockInvoiceParty}
                    onChange={(e) => setMockInvoiceParty(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-black rounded border border-white/20 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-gray-400 block mb-1">Gross Amount (₹)</label>
                  <input
                    type="number"
                    value={mockInvoiceAmount}
                    onChange={(e) => setMockInvoiceAmount(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-black rounded border border-white/20 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-gray-400 block mb-1">Document Attachment</label>
                  <input
                    type="text"
                    value={mockInvoiceName}
                    onChange={(e) => setMockInvoiceName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-black rounded border border-white/20 text-xs text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowUploadModal(false)}
                  className="px-3 py-1 bg-white/5 rounded text-xs font-mono text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const newInv: InvoiceRecord = {
                      id: `INV-${Date.now().toString().slice(-4)}`,
                      invoiceNumber: `NX-INV-2026-09-${Math.floor(100 + Math.random() * 900)}`,
                      salonOrVendor: mockInvoiceParty,
                      invoiceDate: '2026-09-28',
                      grossAmount: mockInvoiceAmount,
                      gstAmount: Math.round(mockInvoiceAmount * 0.18),
                      type: 'Platform 10% Fee',
                      fileAttachment: mockInvoiceName,
                      status: 'verified',
                    };
                    onRequestAudit(
                      'Tax Invoice Upload',
                      newInv.invoiceNumber,
                      'Invoice Filing',
                      'none',
                      `Verified upload for ${newInv.salonOrVendor}`,
                      () => {
                        onUploadInvoice(newInv);
                        setShowUploadModal(false);
                      }
                    );
                  }}
                  className="metallic-button-strong px-4 py-1 rounded text-xs font-mono"
                >
                  Submit & Audit
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 17. DISPATCH TRACKING */}
      {subView === 'dispatches' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Dispatch Tracking & Hardware Kits</h3>
              <p className="text-xs font-mono text-gray-400">Blue Dart Luxury & White-Glove courier AWB live logistics</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#D4AF37]/20 bg-[#0A0A0A]">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#111111] text-gray-400 font-mono text-[10px] uppercase border-b border-[#D4AF37]/20">
                <tr>
                  <th className="p-3">AWB Tracking #</th>
                  <th className="p-3">Recipient & Salon</th>
                  <th className="p-3">Package Contents</th>
                  <th className="p-3">Destination</th>
                  <th className="p-3">Courier Partner</th>
                  <th className="p-3">Dispatch Date</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                {dispatches.map((dsp) => (
                  <tr key={dsp.id} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-mono font-medium text-[#D4AF37]">{dsp.awbNumber}</td>
                    <td className="p-3">
                      <div className="text-white font-medium">{dsp.recipientName}</div>
                      <div className="text-[10px] text-gray-400">{dsp.salonName}</div>
                    </td>
                    <td className="p-3 text-gray-300">{dsp.packageType}</td>
                    <td className="p-3 font-mono text-gray-400">{dsp.destinationCity}</td>
                    <td className="p-3 font-mono text-[10px] text-gray-400">{dsp.courierPartner}</td>
                    <td className="p-3 font-mono text-xs">{dsp.dispatchDate}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                          dsp.status === 'delivered'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : 'bg-blue-950 text-blue-300 border border-blue-500/40'
                        }`}
                      >
                        {dsp.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {dsp.status !== 'delivered' && (
                        <button
                          onClick={() =>
                            onRequestAudit(
                              'Dispatch Tracking',
                              dsp.awbNumber,
                              'Delivery Status',
                              dsp.status,
                              'delivered',
                              () => onUpdateDispatchStatus(dsp.id, 'delivered')
                            )
                          }
                          className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono"
                        >
                          Mark Delivered
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 18. VEHICLE REGISTRATIONS */}
      {subView === 'vehicles' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-serif font-medium text-white">Vehicle Registration Records (Fleet & Chauffeur)</h3>
              <p className="text-xs font-mono text-gray-400">VIP guest transport, Mercedes Maybach / BMW 7-Series luxury fleet audits</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {vehicles.map((veh) => (
              <div key={veh.id} className="bg-[#0A0A0A] p-4 rounded-lg border border-[#D4AF37]/25 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-[#D4AF37] block">{veh.vehicleNumber}</span>
                    <h4 className="text-sm font-medium text-white mt-0.5">{veh.model}</h4>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase ${
                      veh.inspectionStatus === 'certified'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {veh.inspectionStatus.replace('_', ' ')}
                  </span>
                </div>

                <div className="p-2.5 bg-black/60 rounded border border-white/5 text-xs font-mono space-y-1">
                  <p className="text-gray-300">Driver: {veh.driverName} ({veh.driverPhone})</p>
                  <p className="text-[#D4AF37] text-[10px]">Role: {veh.assignedRole}</p>
                  <p className="text-gray-500 text-[10px]">Permit Expiry: {veh.permitExpiry}</p>
                </div>

                <div className="flex justify-end pt-2 border-t border-white/10">
                  <button
                    onClick={() =>
                      onRequestAudit(
                        'Vehicle Fleet',
                        veh.vehicleNumber,
                        'Inspection Certification',
                        veh.inspectionStatus,
                        veh.inspectionStatus === 'certified' ? 'pending_audit' : 'certified',
                        () =>
                          onUpdateVehicleInspection(
                            veh.id,
                            veh.inspectionStatus === 'certified' ? 'pending_audit' : 'certified'
                          )
                      )
                    }
                    className="px-3 py-1 bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300 border border-white/20 rounded"
                  >
                    Toggle Certificate Status
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
