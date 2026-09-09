// ============================================================================
// Nexora SalonOS — Staff Performance Dashboard Owner API Routes
// ----------------------------------------------------------------------------
// Provides Express endpoint handlers for:
//   - GET /api/owner/staff-performance/summary
//   - GET /api/owner/staff-performance/leaderboard
//   - GET /api/owner/staff-performance/bookings
//   - GET /api/owner/staff-performance/payments
//   - GET /api/owner/staff-performance/reviews
//   - POST /api/owner/staff-performance/commission
// ============================================================================

import type { Express, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { databaseForToken } from './backendContext.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

async function resolveOwnerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { data: { user }, error } = await adminSupabase.auth.getUser(token);
      if (user && !error) return user.id;
    } catch {
      // An unverified caller has no owner access.
    }
  }

  return null;
}

export function registerStaffPerformanceRoutes(app: Express) {
  // 1. Staff Performance Summary
  app.get('/api/owner/staff-performance/summary', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { startDate, endDate } = req.query;

      // Call RPC or fallback to custom admin query
      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_staff_performance_summary', {
        p_start_date: startDate ? String(startDate) : null,
        p_end_date: endDate ? String(endDate) : null,
      });

      if (error) return res.status(503).json({ error: 'Staff performance could not be loaded.', code: 'staff_backend_unavailable' });

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 2. 7-Day Performance Leaderboard
  app.get('/api/owner/staff-performance/leaderboard', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_seven_day_leaderboard');
      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 3. Staff Booking Details
  app.get('/api/owner/staff-performance/bookings', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { staffId, status, limit, offset } = req.query;
      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_staff_booking_details', {
        p_staff_id: staffId ? String(staffId) : null,
        p_status: status ? String(status) : null,
        p_limit: limit ? Number(limit) : 50,
        p_offset: offset ? Number(offset) : 0,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 4. Staff Payment Details
  app.get('/api/owner/staff-performance/payments', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { staffId, limit, offset } = req.query;
      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_staff_payment_details', {
        p_staff_id: staffId ? String(staffId) : null,
        p_limit: limit ? Number(limit) : 50,
        p_offset: offset ? Number(offset) : 0,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 5. Staff Review Details
  app.get('/api/owner/staff-performance/reviews', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { staffId, limit, offset } = req.query;
      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_staff_review_details', {
        p_staff_id: staffId ? String(staffId) : null,
        p_limit: limit ? Number(limit) : 50,
        p_offset: offset ? Number(offset) : 0,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 6. Update Staff Commission Settings
  app.post('/api/owner/staff-performance/commission', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { staffId, commissionRate, fixedAmount, commissionType, commissionBasis } = req.body;

      if (!staffId) {
        return res.status(400).json({ error: 'Missing required staffId parameter' });
      }

      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_update_staff_commission', {
        p_staff_id: staffId,
        p_commission_rate: Number(commissionRate ?? 0),
        p_fixed_amount: Number(fixedAmount ?? 0),
        p_commission_type: commissionType || 'percentage',
        p_commission_basis: commissionBasis || 'net',
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 7. Monthly Payroll Calculation
  app.get('/api/owner/staff-performance/payroll', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { period } = req.query;
      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_get_monthly_payroll', {
        p_payout_period: period ? String(period) : null,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 8. Mark Staff Payout as Paid
  app.post('/api/owner/staff-performance/payout/mark-paid', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const {
        staffId,
        payoutPeriod,
        grossSales,
        commissionEarned,
        bonusAmount,
        deductionsAmount,
        netPayout,
        status,
        paymentMethod,
        paymentReference,
        notes,
      } = req.body;

      if (!staffId || !payoutPeriod) {
        return res.status(400).json({ error: 'Missing required parameters: staffId and payoutPeriod' });
      }

      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_mark_payout_paid', {
        p_staff_id: staffId,
        p_payout_period: payoutPeriod,
        p_gross_sales: Number(grossSales ?? 0),
        p_commission_earned: Number(commissionEarned ?? 0),
        p_bonus_amount: Number(bonusAmount ?? 0),
        p_deductions_amount: Number(deductionsAmount ?? 0),
        p_net_payout: Number(netPayout ?? 0),
        p_status: status || 'Paid',
        p_payment_method: paymentMethod || 'Bank Transfer',
        p_payment_reference: paymentReference || null,
        p_notes: notes || null,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 9. Staff Payout History
  app.get('/api/owner/staff-performance/payout/history', async (req: Request, res: Response) => {
    try {
      const ownerId = await resolveOwnerId(req);
      if (!ownerId) {
        return res.status(401).json({ error: 'Unauthorized: Owner credentials required' });
      }

      const { staffId } = req.query;
      const { data, error } = await databaseForToken(String(req.headers.authorization).slice(7)).rpc('owner_get_payout_history', {
        p_staff_id: staffId ? String(staffId) : null,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ data: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });
}
