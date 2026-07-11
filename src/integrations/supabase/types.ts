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
      agent_projects: {
        Row: {
          characters: Json
          created_at: string
          final_video_url: string | null
          id: string
          logline: string | null
          premise: string
          shots_plan: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          characters?: Json
          created_at?: string
          final_video_url?: string | null
          id?: string
          logline?: string | null
          premise: string
          shots_plan?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          characters?: Json
          created_at?: string
          final_video_url?: string | null
          id?: string
          logline?: string | null
          premise?: string
          shots_plan?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_shots: {
        Row: {
          audio_url: string | null
          created_at: string
          dialogue: string | null
          error: string | null
          final_url: string | null
          frame_url: string | null
          id: string
          idx: number
          project_id: string
          prompt: string
          speaker: string | null
          status: string
          updated_at: string
          user_id: string
          video_url: string | null
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          dialogue?: string | null
          error?: string | null
          final_url?: string | null
          frame_url?: string | null
          id?: string
          idx: number
          project_id: string
          prompt: string
          speaker?: string | null
          status?: string
          updated_at?: string
          user_id: string
          video_url?: string | null
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          dialogue?: string | null
          error?: string | null
          final_url?: string | null
          frame_url?: string | null
          id?: string
          idx?: number
          project_id?: string
          prompt?: string
          speaker?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_shots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "agent_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_voices: {
        Row: {
          character_name: string
          created_at: string
          id: string
          project_id: string
          sheet_url: string | null
          user_id: string
          voice_id: string
        }
        Insert: {
          character_name: string
          created_at?: string
          id?: string
          project_id: string
          sheet_url?: string | null
          user_id: string
          voice_id: string
        }
        Update: {
          character_name?: string
          created_at?: string
          id?: string
          project_id?: string
          sheet_url?: string | null
          user_id?: string
          voice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_voices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "agent_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      bible_characters: {
        Row: {
          bible_id: string
          created_at: string
          description: string
          id: string
          name: string
          ref_image_url: string | null
          ref_image_variants: Json
          token: string
          updated_at: string
          user_id: string
          visual_seed: number
          voice_id: string | null
          voice_params: Json
        }
        Insert: {
          bible_id: string
          created_at?: string
          description: string
          id?: string
          name: string
          ref_image_url?: string | null
          ref_image_variants?: Json
          token: string
          updated_at?: string
          user_id: string
          visual_seed?: number
          voice_id?: string | null
          voice_params?: Json
        }
        Update: {
          bible_id?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          ref_image_url?: string | null
          ref_image_variants?: Json
          token?: string
          updated_at?: string
          user_id?: string
          visual_seed?: number
          voice_id?: string | null
          voice_params?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bible_characters_bible_id_fkey"
            columns: ["bible_id"]
            isOneToOne: false
            referencedRelation: "story_bibles"
            referencedColumns: ["id"]
          },
        ]
      }
      bible_locations: {
        Row: {
          bible_id: string
          created_at: string
          description: string
          id: string
          lighting: string | null
          name: string
          palette: Json
          ref_image_url: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bible_id: string
          created_at?: string
          description: string
          id?: string
          lighting?: string | null
          name: string
          palette?: Json
          ref_image_url?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bible_id?: string
          created_at?: string
          description?: string
          id?: string
          lighting?: string | null
          name?: string
          palette?: Json
          ref_image_url?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bible_locations_bible_id_fkey"
            columns: ["bible_id"]
            isOneToOne: false
            referencedRelation: "story_bibles"
            referencedColumns: ["id"]
          },
        ]
      }
      bible_scenes: {
        Row: {
          beat: string
          bible_id: string
          character_ids: string[]
          created_at: string
          dialogue: Json
          duration_estimate: number
          id: string
          location_id: string | null
          locked: boolean
          scene_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          beat: string
          bible_id: string
          character_ids?: string[]
          created_at?: string
          dialogue?: Json
          duration_estimate?: number
          id?: string
          location_id?: string | null
          locked?: boolean
          scene_index: number
          updated_at?: string
          user_id: string
        }
        Update: {
          beat?: string
          bible_id?: string
          character_ids?: string[]
          created_at?: string
          dialogue?: Json
          duration_estimate?: number
          id?: string
          location_id?: string | null
          locked?: boolean
          scene_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bible_scenes_bible_id_fkey"
            columns: ["bible_id"]
            isOneToOne: false
            referencedRelation: "story_bibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bible_scenes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "bible_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      bible_shots: {
        Row: {
          attempt_count: number
          audio_url: string | null
          bible_id: string
          camera: string | null
          character_ids: string[]
          clip_url: string | null
          created_at: string
          dialogue_slice: Json
          duration_seconds: number
          id: string
          location_id: string | null
          qc_notes: string | null
          qc_score: number | null
          scene_id: string
          seed: number
          shot_index: number
          status: string
          updated_at: string
          user_id: string
          visual_prompt: string
        }
        Insert: {
          attempt_count?: number
          audio_url?: string | null
          bible_id: string
          camera?: string | null
          character_ids?: string[]
          clip_url?: string | null
          created_at?: string
          dialogue_slice?: Json
          duration_seconds?: number
          id?: string
          location_id?: string | null
          qc_notes?: string | null
          qc_score?: number | null
          scene_id: string
          seed?: number
          shot_index: number
          status?: string
          updated_at?: string
          user_id: string
          visual_prompt: string
        }
        Update: {
          attempt_count?: number
          audio_url?: string | null
          bible_id?: string
          camera?: string | null
          character_ids?: string[]
          clip_url?: string | null
          created_at?: string
          dialogue_slice?: Json
          duration_seconds?: number
          id?: string
          location_id?: string | null
          qc_notes?: string | null
          qc_score?: number | null
          scene_id?: string
          seed?: number
          shot_index?: number
          status?: string
          updated_at?: string
          user_id?: string
          visual_prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "bible_shots_bible_id_fkey"
            columns: ["bible_id"]
            isOneToOne: false
            referencedRelation: "story_bibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bible_shots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "bible_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bible_shots_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "bible_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      character_embeddings: {
        Row: {
          character_token: string
          created_at: string
          embedding: string
          id: string
          metadata: Json
          model_version: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          character_token: string
          created_at?: string
          embedding: string
          id?: string
          metadata?: Json
          model_version?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          character_token?: string
          created_at?: string
          embedding?: string
          id?: string
          metadata?: Json
          model_version?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scene_embeddings: {
        Row: {
          character_token: string
          created_at: string
          embedding: string
          id: string
          metadata: Json
          model_version: string
          project_id: string
          scene_id: string
          user_id: string
        }
        Insert: {
          character_token: string
          created_at?: string
          embedding: string
          id?: string
          metadata?: Json
          model_version?: string
          project_id: string
          scene_id: string
          user_id: string
        }
        Update: {
          character_token?: string
          created_at?: string
          embedding?: string
          id?: string
          metadata?: Json
          model_version?: string
          project_id?: string
          scene_id?: string
          user_id?: string
        }
        Relationships: []
      }
      story_bibles: {
        Row: {
          brief: string
          created_at: string
          global_seed: number
          id: string
          plan: Json
          project_id: string
          stage: string
          status: string
          style_bible: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          brief: string
          created_at?: string
          global_seed?: number
          id?: string
          plan?: Json
          project_id: string
          stage?: string
          status?: string
          style_bible?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          brief?: string
          created_at?: string
          global_seed?: number
          id?: string
          plan?: Json
          project_id?: string
          stage?: string
          status?: string
          style_bible?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_character_embedding: {
        Args: {
          p_character_token: string
          p_project_id: string
          p_query_embedding: string
        }
        Returns: {
          id: string
          metadata: Json
          similarity: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
