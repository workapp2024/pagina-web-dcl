export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string;
          price: number;
          previous_price: number | null;
          category: string;
          image_url: string;
          cta_text: string;
          featured: boolean;
          active: boolean;
          sort_order: number;
          watts: number | null;
          lumens: number | null;
          voltage: string | null;
          color_temperature: string | null;
          connector_type: string | null;
          canbus: boolean;
          chip_type: string | null;
          warranty: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          slug: string;
          description?: string;
          price?: number;
          previous_price?: number | null;
          category?: string;
          image_url?: string;
          cta_text?: string;
          featured?: boolean;
          active?: boolean;
          sort_order?: number;
          watts?: number | null;
          lumens?: number | null;
          voltage?: string | null;
          color_temperature?: string | null;
          connector_type?: string | null;
          canbus?: boolean;
          chip_type?: string | null;
          warranty?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          description?: string;
          price?: number;
          previous_price?: number | null;
          category?: string;
          image_url?: string;
          cta_text?: string;
          featured?: boolean;
          active?: boolean;
          sort_order?: number;
          watts?: number | null;
          lumens?: number | null;
          voltage?: string | null;
          color_temperature?: string | null;
          connector_type?: string | null;
          canbus?: boolean;
          chip_type?: string | null;
          warranty?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      promotions: {
        Row: {
          id: string;
          title: string;
          description: string;
          image_url: string;
          price: string | null;
          cta_text: string;
          cta_href: string;
          start_date: string | null;
          end_date: string | null;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          title: string;
          description?: string;
          image_url?: string;
          price?: string | null;
          cta_text?: string;
          cta_href?: string;
          start_date?: string | null;
          end_date?: string | null;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          image_url?: string;
          price?: string | null;
          cta_text?: string;
          cta_href?: string;
          start_date?: string | null;
          end_date?: string | null;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicle_categories: {
        Row: {
          id: string;
          title: string;
          description: string;
          image_url: string;
          href: string;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          title: string;
          description?: string;
          image_url?: string;
          href?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          image_url?: string;
          href?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      site_settings: {
        Row: {
          id: number;
          logo_url: string;
          whatsapp: string;
          instagram: string;
          facebook: string;
          email: string;
          phone: string;
          address: string;
          vehicle_section_title: string;
          needs_section_title: string;
          why_us_section_title: string;
          products_section_title: string;
          promotions_section_title: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          logo_url?: string;
          whatsapp?: string;
          instagram?: string;
          facebook?: string;
          email?: string;
          phone?: string;
          address?: string;
          vehicle_section_title?: string;
          needs_section_title?: string;
          why_us_section_title?: string;
          products_section_title?: string;
          promotions_section_title?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          logo_url?: string;
          whatsapp?: string;
          instagram?: string;
          facebook?: string;
          email?: string;
          phone?: string;
          address?: string;
          vehicle_section_title?: string;
          needs_section_title?: string;
          why_us_section_title?: string;
          products_section_title?: string;
          promotions_section_title?: string;
          updated_at?: string;
        };
      };
      home_settings: {
        Row: {
          id: number;
          hero_title: string;
          hero_subtitle: string;
          hero_primary_cta: string;
          hero_secondary_cta: string;
          hero_image_url: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          hero_title?: string;
          hero_subtitle?: string;
          hero_primary_cta?: string;
          hero_secondary_cta?: string;
          hero_image_url?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          hero_title?: string;
          hero_subtitle?: string;
          hero_primary_cta?: string;
          hero_secondary_cta?: string;
          hero_image_url?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
