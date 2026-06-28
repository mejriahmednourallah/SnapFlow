export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      activity_reports: {
        Row: {
          archived_at: string | null
          created_at: string
          filters: Json | null
          id: string
          project_id: string
          report_data: Json | null
          ticket_count: number | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          filters?: Json | null
          id?: string
          project_id: string
          report_data?: Json | null
          ticket_count?: number | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          filters?: Json | null
          id?: string
          project_id?: string
          report_data?: Json | null
          ticket_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audits: {
        Row: {
          archived_at: string | null
          created_at: string
          error_message: string | null
          id: string
          project_id: string
          report_data: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          project_id: string
          report_data?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          project_id?: string
          report_data?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }      notifications: {
        Row: {
          category: string
          created_at: string
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          reference_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          reference_type?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          reference_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      project_assignments: {
        Row: {
          access_level: string
          assigned_at: string
          id: string
          project_id: string
          redmine_group_ids: number[]
          redmine_role_ids: number[]
          redmine_role_names: string[]
          redmine_synced_at: string | null
          source: string
          user_id: string
        }
        Insert: {
          access_level?: string
          assigned_at?: string
          id?: string
          project_id: string
          redmine_group_ids?: number[]
          redmine_role_ids?: number[]
          redmine_role_names?: string[]
          redmine_synced_at?: string | null
          source?: string
          user_id: string
        }
        Update: {
          access_level?: string
          assigned_at?: string
          id?: string
          project_id?: string
          redmine_group_ids?: number[]
          redmine_role_ids?: number[]
          redmine_role_names?: string[]
          redmine_synced_at?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          audit_url_needs_review: boolean
          client_id: string
          created_at: string
          id: string
          logo_url: string | null
          redmine_identifier: string | null
          redmine_url: string | null
          site_name: string
          url: string
        }
        Insert: {
          audit_url_needs_review?: boolean
          client_id: string
          created_at?: string
          id?: string
          logo_url?: string | null
          redmine_identifier?: string | null
          redmine_url?: string | null
          site_name: string
          url: string
        }
        Update: {
          audit_url_needs_review?: boolean
          client_id?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          redmine_identifier?: string | null
          redmine_url?: string | null
          site_name?: string
          url?: string
        }
        Relationships: []
      }
      redmine_auth_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_hash: string
          login_hash: string
          reason: string | null
          redmine_user_id: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_hash: string
          login_hash: string
          reason?: string | null
          redmine_user_id?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string
          login_hash?: string
          reason?: string | null
          redmine_user_id?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      redmine_login_attempts: {
        Row: {
          created_at: string
          failure_reason: string | null
          id: string
          ip_hash: string
          login_hash: string
          success: boolean
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          ip_hash: string
          login_hash: string
          success?: boolean
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          ip_hash?: string
          login_hash?: string
          success?: boolean
        }
        Relationships: []
      }
      redmine_role_mappings: {
        Row: {
          access_level: string
          can_create_ticket: boolean
          can_import: boolean
          can_launch_audit: boolean
          can_view_reports: boolean
          created_at: string
          redmine_role_id: number
          redmine_role_name: string
          updated_at: string
        }
        Insert: {
          access_level?: string
          can_create_ticket?: boolean
          can_import?: boolean
          can_launch_audit?: boolean
          can_view_reports?: boolean
          created_at?: string
          redmine_role_id: number
          redmine_role_name: string
          updated_at?: string
        }
        Update: {
          access_level?: string
          can_create_ticket?: boolean
          can_import?: boolean
          can_launch_audit?: boolean
          can_view_reports?: boolean
          created_at?: string
          redmine_role_id?: number
          redmine_role_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      redmine_user_identities: {
        Row: {
          created_at: string
          last_login_at: string | null
          redmine_display_name: string | null
          redmine_email: string | null
          redmine_login: string
          redmine_user_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_login_at?: string | null
          redmine_display_name?: string | null
          redmine_email?: string | null
          redmine_login: string
          redmine_user_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_login_at?: string | null
          redmine_display_name?: string | null
          redmine_email?: string | null
          redmine_login?: string
          redmine_user_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_schedules: {
        Row: {
          created_at: string
          created_by: string
          day_of_month: number | null
          day_of_week: number | null
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean
          last_run_at: string | null
          next_run_at: string
          project_id: string
          report_type: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          day_of_month?: number | null
          day_of_week?: number | null
          end_date?: string | null
          frequency: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at: string
          project_id: string
          report_type: string
          start_date?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          day_of_month?: number | null
          day_of_week?: number | null
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string
          project_id?: string
          report_type?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_usage: {
        Row: {
          email: string
          id: string
          used_at: string
        }
        Insert: {
          email: string
          id?: string
          used_at?: string
        }
        Update: {
          email?: string
          id?: string
          used_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "charge_de_projet" | "testeur" | "rapporteur"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "charge_de_projet", "testeur", "rapporteur"],
    },
  },
} as const
