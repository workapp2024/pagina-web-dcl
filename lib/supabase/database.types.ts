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
          show_in_catalog: boolean;
          sort_order: number;
          watts: number | null;
          lumens: number | null;
          voltage: string | null;
          color_temperature: string | null;
          connector_type: string | null;
          canbus: boolean;
          chip_type: string | null;
          warranty: string | null;
          warranty_days: number | null;
          cost_price: number | null;
          margin_percentage: number | null;
          stock: number;
          stock_min: number;
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
          show_in_catalog?: boolean;
          sort_order?: number;
          watts?: number | null;
          lumens?: number | null;
          voltage?: string | null;
          color_temperature?: string | null;
          connector_type?: string | null;
          canbus?: boolean;
          chip_type?: string | null;
          warranty?: string | null;
          warranty_days?: number | null;
          cost_price?: number | null;
          margin_percentage?: number | null;
          stock?: number;
          stock_min?: number;
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
          show_in_catalog?: boolean;
          sort_order?: number;
          watts?: number | null;
          lumens?: number | null;
          voltage?: string | null;
          color_temperature?: string | null;
          connector_type?: string | null;
          canbus?: boolean;
          chip_type?: string | null;
          warranty?: string | null;
          warranty_days?: number | null;
          cost_price?: number | null;
          margin_percentage?: number | null;
          stock?: number;
          stock_min?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      inventory_movements: {
        Row: {
          id: string;
          product_id: string;
          movement_type: "entrada" | "salida" | "ajuste" | "venta";
          quantity_delta: number;
          reason: string;
          reference_type: string | null;
          reference_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          movement_type: "entrada" | "salida" | "ajuste" | "venta";
          quantity_delta: number;
          reason?: string;
          reference_type?: string | null;
          reference_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          movement_type?: "entrada" | "salida" | "ajuste" | "venta";
          quantity_delta?: number;
          reason?: string;
          reference_type?: string | null;
          reference_id?: string | null;
          created_at?: string;
        };
      };
      financial_accounts: {
        Row: { id: string; name: string; account_type: string; active: boolean; sort_order: number; created_at: string };
        Insert: { id: string; name: string; account_type?: string; active?: boolean; sort_order?: number; created_at?: string };
        Update: { id?: string; name?: string; account_type?: string; active?: boolean; sort_order?: number; created_at?: string };
      };
      financial_periods: {
        Row: { id: string; name: string; starts_at: string; ends_at: string | null; status: "open" | "closed"; created_at: string; closed_at: string | null };
        Insert: { id?: string; name: string; starts_at?: string; ends_at?: string | null; status?: "open" | "closed"; created_at?: string; closed_at?: string | null };
        Update: { id?: string; name?: string; starts_at?: string; ends_at?: string | null; status?: "open" | "closed"; created_at?: string; closed_at?: string | null };
      };
      financial_activation: {
        Row: { singleton: boolean; activated_at: string; initial_period_id: string; activation_key: string };
        Insert: { singleton?: boolean; activated_at?: string; initial_period_id: string; activation_key: string };
        Update: { singleton?: boolean; activated_at?: string; initial_period_id?: string; activation_key?: string };
      };
      financial_operation_requests: {
        Row: { idempotency_key: string; operation_type: string; result_id: string | null; created_at: string };
        Insert: { idempotency_key: string; operation_type: string; result_id?: string | null; created_at?: string };
        Update: { idempotency_key?: string; operation_type?: string; result_id?: string | null; created_at?: string };
      };
      cash_movements: {
        Row: { id: string; movement_type: string; amount: number; occurred_at: string; description: string; sale_id: string | null; account_id: string | null; period_id: string | null; transfer_id: string | null; idempotency_key: string | null; created_at: string };
        Insert: { id?: string; movement_type: string; amount: number; occurred_at?: string; description?: string; sale_id?: string | null; account_id?: string | null; period_id?: string | null; transfer_id?: string | null; idempotency_key?: string | null; created_at?: string };
        Update: { id?: string; movement_type?: string; amount?: number; occurred_at?: string; description?: string; sale_id?: string | null; account_id?: string | null; period_id?: string | null; transfer_id?: string | null; idempotency_key?: string | null; created_at?: string };
      };
      customers: {
        Row: { id: string; full_name: string; phone: string | null; email: string | null; document_number: string | null; notes: string; created_at: string; updated_at: string };
        Insert: { id?: string; full_name: string; phone?: string | null; email?: string | null; document_number?: string | null; notes?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; full_name?: string; phone?: string | null; email?: string | null; document_number?: string | null; notes?: string; created_at?: string; updated_at?: string };
      };
      customer_vehicles: {
        Row: { id: string; customer_id: string; vehicle_model_id: string | null; brand_name: string; model_name: string; year: number | null; plate: string | null; notes: string; created_at: string; updated_at: string };
        Insert: { id?: string; customer_id: string; vehicle_model_id?: string | null; brand_name: string; model_name: string; year?: number | null; plate?: string | null; notes?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; customer_id?: string; vehicle_model_id?: string | null; brand_name?: string; model_name?: string; year?: number | null; plate?: string | null; notes?: string; created_at?: string; updated_at?: string };
      };
      sales: {
        Row: { id: string; customer_id: string; customer_vehicle_id: string | null; status: "completed" | "cancelled"; notes: string; subtotal: number; total: number; payment_method: "cash" | "transfer" | "mercadopago" | "debit" | "credit" | "other"; idempotency_key: string | null; created_at: string };
        Insert: { id?: string; customer_id: string; customer_vehicle_id?: string | null; status?: "completed" | "cancelled"; notes?: string; subtotal?: number; total?: number; payment_method?: "cash" | "transfer" | "mercadopago" | "debit" | "credit" | "other"; idempotency_key?: string | null; created_at?: string };
        Update: { id?: string; customer_id?: string; customer_vehicle_id?: string | null; status?: "completed" | "cancelled"; notes?: string; subtotal?: number; total?: number; payment_method?: "cash" | "transfer" | "mercadopago" | "debit" | "credit" | "other"; idempotency_key?: string | null; created_at?: string };
      };
      sale_items: {
        Row: { id: string; sale_id: string; product_id: string; product_name: string; quantity: number; unit_price: number; unit_cost: number | null; line_total: number; created_at: string };
        Insert: { id?: string; sale_id: string; product_id: string; product_name: string; quantity: number; unit_price: number; unit_cost?: number | null; line_total: number; created_at?: string };
        Update: { id?: string; sale_id?: string; product_id?: string; product_name?: string; quantity?: number; unit_price?: number; unit_cost?: number | null; line_total?: number; created_at?: string };
      };
      installations: {
        Row: { id: string; sale_id: string; customer_vehicle_id: string | null; status: "pending" | "completed" | "cancelled"; scheduled_at: string | null; completed_at: string | null; notes: string; location: string | null; contact_phone: string | null; work_type: string | null; estimated_difficulty: "low" | "medium" | "high" | null; assigned_technician: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; sale_id: string; customer_vehicle_id?: string | null; status?: "pending" | "completed" | "cancelled"; scheduled_at?: string | null; completed_at?: string | null; notes?: string; location?: string | null; contact_phone?: string | null; work_type?: string | null; estimated_difficulty?: "low" | "medium" | "high" | null; assigned_technician?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; sale_id?: string; customer_vehicle_id?: string | null; status?: "pending" | "completed" | "cancelled"; scheduled_at?: string | null; completed_at?: string | null; notes?: string; location?: string | null; contact_phone?: string | null; work_type?: string | null; estimated_difficulty?: "low" | "medium" | "high" | null; assigned_technician?: string | null; created_at?: string; updated_at?: string };
      };
      warranties: {
        Row: { id: string; sale_item_id: string; customer_id: string; customer_vehicle_id: string | null; status: "active" | "expired" | "void"; starts_at: string; expires_at: string | null; notes: string; created_at: string };
        Insert: { id?: string; sale_item_id: string; customer_id: string; customer_vehicle_id?: string | null; status?: "active" | "expired" | "void"; starts_at?: string; expires_at?: string | null; notes?: string; created_at?: string };
        Update: { id?: string; sale_item_id?: string; customer_id?: string; customer_vehicle_id?: string | null; status?: "active" | "expired" | "void"; starts_at?: string; expires_at?: string | null; notes?: string; created_at?: string };
      };
      warranty_claims: {
        Row: { id: string; warranty_id: string; status: "open" | "resolved" | "rejected"; description: string; resolution: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; warranty_id: string; status?: "open" | "resolved" | "rejected"; description: string; resolution?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; warranty_id?: string; status?: "open" | "resolved" | "rejected"; description?: string; resolution?: string | null; created_at?: string; updated_at?: string };
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
      radio_stations: {
        Row: {
          id: string;
          name: string;
          genre: string;
          stream_url: string;
          cover_url: string | null;
          description: string;
          active: boolean;
          featured: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          genre?: string;
          stream_url: string;
          cover_url?: string | null;
          description?: string;
          active?: boolean;
          featured?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          genre?: string;
          stream_url?: string;
          cover_url?: string | null;
          description?: string;
          active?: boolean;
          featured?: boolean;
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
          theme_preset: "dcl-dark" | "clean-light" | "graphite-pro" | "midnight-blue";
          radio_enabled: boolean;
          radio_show_player: boolean;
          radio_name: string;
          radio_stream_url: string;
          radio_subtitle: string;
          transfer_alias: string;
          transfer_cbu_cvu: string;
          transfer_holder: string;
          transfer_institution: string;
          transfer_instructions: string;
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
          theme_preset?: "dcl-dark" | "clean-light" | "graphite-pro" | "midnight-blue";
          radio_enabled?: boolean;
          radio_show_player?: boolean;
          radio_name?: string;
          radio_stream_url?: string;
          radio_subtitle?: string;
          transfer_alias?: string;
          transfer_cbu_cvu?: string;
          transfer_holder?: string;
          transfer_institution?: string;
          transfer_instructions?: string;
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
          theme_preset?: "dcl-dark" | "clean-light" | "graphite-pro" | "midnight-blue";
          radio_enabled?: boolean;
          radio_show_player?: boolean;
          radio_name?: string;
          radio_stream_url?: string;
          radio_subtitle?: string;
          transfer_alias?: string;
          transfer_cbu_cvu?: string;
          transfer_holder?: string;
          transfer_institution?: string;
          transfer_instructions?: string;
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
      vehicle_brands: {
        Row: {
          id: string;
          name: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicle_models: {
        Row: {
          id: string;
          brand_id: string;
          name: string;
          vehicle_type: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          brand_id: string;
          name: string;
          vehicle_type?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          name?: string;
          vehicle_type?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      vehicle_compatibilities: {
        Row: {
          id: string;
          model_id: string;
          year_from: number;
          year_to: number | null;
          version: string | null;
          connector_low: string | null;
          connector_high: string | null;
          connector_fog: string | null;
          connector_aux: string | null;
          combined_high_low: boolean;
          notes: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          model_id: string;
          year_from: number;
          year_to?: number | null;
          version?: string | null;
          connector_low?: string | null;
          connector_high?: string | null;
          connector_fog?: string | null;
          connector_aux?: string | null;
          combined_high_low?: boolean;
          notes?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          model_id?: string;
          year_from?: number;
          year_to?: number | null;
          version?: string | null;
          connector_low?: string | null;
          connector_high?: string | null;
          connector_fog?: string | null;
          connector_aux?: string | null;
          combined_high_low?: boolean;
          notes?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_sale_with_inventory: {
        Args: { p_customer_id: string; p_customer_vehicle_id: string | null; p_notes: string; p_items: Json; p_create_installation?: boolean; p_payment_method?: string; p_idempotency_key?: string | null };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
  };
}
