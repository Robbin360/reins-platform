export type PurchaseStatus = 'approved' | 'rejected' | 'pending' | 'expired';
export type Environment = 'staging' | 'production';
export type Urgency = 'low' | 'normal' | 'critical';
export type TrustLevel = 'low' | 'standard' | 'high';

export interface PolicyDecision {
  status: PurchaseStatus;
  decision_by: string;
  reason: string;
  policy_id?: string;
  expires_at?: string;
}

export interface PurchaseRequest {
  agent_id: string;
  amount: number;
  category: string;
  vendor: string;
  reason?: string;
  environment?: Environment;
  urgency?: Urgency;
  organization_id?: string;
}
