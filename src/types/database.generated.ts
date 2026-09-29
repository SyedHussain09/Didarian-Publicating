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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notes: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          note: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          note: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          note?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          abstract: string
          author_names: string
          category: string
          download_filename: string
          download_media_type: string
          id: string
          keywords: string[]
          published_at: string
          slug: string
          title: string
        }
        Insert: {
          abstract: string
          author_names: string
          category: string
          download_filename: string
          download_media_type: string
          id?: string
          keywords?: string[]
          published_at?: string
          slug: string
          title: string
        }
        Update: {
          abstract?: string
          author_names?: string
          category?: string
          download_filename?: string
          download_media_type?: string
          id?: string
          keywords?: string[]
          published_at?: string
          slug?: string
          title?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          handled_at: string | null
          id: string
          message: string
          name: string
          state: string
        }
        Insert: {
          created_at?: string
          email: string
          handled_at?: string | null
          id?: string
          message: string
          name: string
          state?: string
        }
        Update: {
          created_at?: string
          email?: string
          handled_at?: string | null
          id?: string
          message?: string
          name?: string
          state?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          event_id: string
          id: string
          message: string
          read_at: string | null
          recipient_id: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          message: string
          read_at?: string | null
          recipient_id: string
          submission_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          message?: string
          read_at?: string | null
          recipient_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "submission_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          affiliation: string
          created_at: string
          first_name: string
          id: string
          last_name: string
          updated_at: string
        }
        Insert: {
          affiliation?: string
          created_at?: string
          first_name: string
          id: string
          last_name: string
          updated_at?: string
        }
        Update: {
          affiliation?: string
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      submission_events: {
        Row: {
          created_at: string
          feedback: string
          from_status: Database["public"]["Enums"]["submission_status"]
          id: string
          kind: string
          submission_id: string
          to_status: Database["public"]["Enums"]["submission_status"]
        }
        Insert: {
          created_at?: string
          feedback?: string
          from_status: Database["public"]["Enums"]["submission_status"]
          id?: string
          kind: string
          submission_id: string
          to_status: Database["public"]["Enums"]["submission_status"]
        }
        Update: {
          created_at?: string
          feedback?: string
          from_status?: Database["public"]["Enums"]["submission_status"]
          id?: string
          kind?: string
          submission_id?: string
          to_status?: Database["public"]["Enums"]["submission_status"]
        }
        Relationships: [
          {
            foreignKeyName: "submission_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_files: {
        Row: {
          byte_size: number
          created_at: string
          id: string
          media_type: string
          original_name: string
          sha256: string | null
          storage_path: string
          submission_id: string
          verification_state: Database["public"]["Enums"]["file_verification_state"]
          verified_at: string | null
          version: number
        }
        Insert: {
          byte_size: number
          created_at?: string
          id?: string
          media_type: string
          original_name: string
          sha256?: string | null
          storage_path: string
          submission_id: string
          verification_state?: Database["public"]["Enums"]["file_verification_state"]
          verified_at?: string | null
          version: number
        }
        Update: {
          byte_size?: number
          created_at?: string
          id?: string
          media_type?: string
          original_name?: string
          sha256?: string | null
          storage_path?: string
          submission_id?: string
          verification_state?: Database["public"]["Enums"]["file_verification_state"]
          verified_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          abstract: string
          author_names: string
          category: string
          created_at: string
          current_file_id: string | null
          id: string
          keywords: string[]
          owner_id: string
          publication_consent: boolean
          status: Database["public"]["Enums"]["submission_status"]
          submitted_at: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          abstract?: string
          author_names?: string
          category?: string
          created_at?: string
          current_file_id?: string | null
          id?: string
          keywords?: string[]
          owner_id: string
          publication_consent?: boolean
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Update: {
          abstract?: string
          author_names?: string
          category?: string
          created_at?: string
          current_file_id?: string | null
          id?: string
          keywords?: string[]
          owner_id?: string
          publication_consent?: boolean
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "submissions_current_file_fkey"
            columns: ["id", "current_file_id"]
            isOneToOne: false
            referencedRelation: "submission_files"
            referencedColumns: ["submission_id", "id"]
          },
          {
            foreignKeyName: "submissions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      accept_and_publish: {
        Args: {
          p_expected_version: number
          p_feedback?: string
          p_submission_id: string
        }
        Returns: Json
      }
      add_admin_note: {
        Args: { p_note: string; p_submission_id: string }
        Returns: undefined
      }
      assert_active_session: { Args: never; Returns: string }
      claim_cleanup: { Args: { p_submission_id: string }; Returns: Json }
      finalize_file: {
        Args: {
          p_byte_size: number
          p_file_id: string
          p_media_type: string
          p_sha256: string
        }
        Returns: Json
      }
      get_submission: { Args: { p_submission_id: string }; Returns: Json }
      handle_contact_message: {
        Args: { p_id: string; p_state: string }
        Returns: undefined
      }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      my_role: { Args: never; Returns: string }
      prepare_file: {
        Args: {
          p_byte_size: number
          p_expected_version: number
          p_media_type: string
          p_original_name: string
          p_submission_id: string
        }
        Returns: Json
      }
      publish_admin_article: {
        Args: {
          p_expected_version: number
          p_feedback?: string
          p_submission_id: string
        }
        Returns: Json
      }
      receive_contact: {
        Args: {
          p_email: string
          p_email_hash: string
          p_ip_hash: string
          p_message: string
          p_name: string
        }
        Returns: string
      }
      reject_submission: {
        Args: {
          p_expected_version: number
          p_feedback: string
          p_submission_id: string
        }
        Returns: Json
      }
      resolve_public_asset: { Args: { p_slug: string }; Returns: Json }
      save_draft: {
        Args: {
          p_abstract: string
          p_author_names: string
          p_category: string
          p_expected_version: number
          p_id: string
          p_keywords: string[]
          p_publication_consent: boolean
          p_title: string
        }
        Returns: Json
      }
      start_review: {
        Args: { p_expected_version: number; p_submission_id: string }
        Returns: Json
      }
      submission_article_slug: {
        Args: { p_submission_id: string }
        Returns: string
      }
      submit_submission: {
        Args: { p_expected_version: number; p_submission_id: string }
        Returns: Json
      }
      update_profile: {
        Args: {
          p_affiliation: string
          p_first_name: string
          p_last_name: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "author" | "admin"
      file_verification_state: "pending" | "verified" | "rejected" | "deleting"
      submission_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "published"
        | "rejected"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["author", "admin"],
      file_verification_state: ["pending", "verified", "rejected", "deleting"],
      submission_status: [
        "draft",
        "submitted",
        "under_review",
        "published",
        "rejected",
      ],
    },
  },
} as const

