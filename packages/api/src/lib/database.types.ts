export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: { Row: any; Insert: any; Update: any };
      agents: { Row: any; Insert: any; Update: any };
      policies: { Row: any; Insert: any; Update: any };
      purchase_requests: { Row: any; Insert: any; Update: any };
      audit_log: { Row: any; Insert: any; Update: any };
      budget_usage: { Row: any; Insert: any; Update: any };
    };
  };
}
