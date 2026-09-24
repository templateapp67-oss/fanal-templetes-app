// src/types/growthPartner.ts

export interface GrowthPartner {
  id:           string;
  name:         string;
  email:        string;
  referralCode: string;
  tier:         string;
  joinedAt:     string;
  isActive:     boolean;
}

export interface Referral {
  id:       string;
  name:     string;
  email:    string;
  status:   'active' | 'pending' | 'inactive';
  joinedAt: string;
  earnings: number;
}

export interface EarningsData {
  total:     number;
  pending:   number;
  paid:      number;
  currency:  string;
  breakdown: {
    month:         string;
    amount:        number;
    referralCount: number;
  }[];
}

export interface ApiResponse<T> {
  data:    T | null;
  error:   string | null;
  status:  number;
}
