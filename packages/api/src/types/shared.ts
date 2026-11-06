export type DecisionStatus = 'approved' | 'rejected' | 'pending' | 'expired';
export type Environment = 'staging' | 'production';
export type Urgency = 'low' | 'normal' | 'critical';
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

export interface PolicyDecision {
  status: DecisionStatus;
  decision_by: string;
  reason: string;
  policy_id?: string;
  expires_at?: string;
}

export interface PurchaseRequest {
  agent_id: string;
  action_type: string; // "db_write", "api_call", "infra_provision", "data_export"
  target_resource: string; // "production_db", "stripe_api", "aws_ec2"
  sensitivity_level: SensitivityLevel;
  actor_identity?: string; // ID del SSO corporativo
  environment?: Environment;
  urgency?: Urgency;
  reason?: string;
  organization_id?: string;
}
