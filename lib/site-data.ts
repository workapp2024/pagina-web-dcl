import { whatsappUrl } from "@/lib/whatsapp";
import { DEFAULT_THEME, type ThemePreset } from "@/lib/theme";

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  previousPrice?: number;
  image: string;
  images?: string[];
  category: string;
  featured: boolean;
  active: boolean;
  showInCatalog: boolean;
  href: string;
  ctaText: string;
  order: number;
  // Especificaciones técnicas (compatibilidad y ficha de producto)
  watts?: number;
  lumens?: number;
  voltage?: string;
  colorTemperature?: string;
  connectorType?: string;
  canbus?: boolean;
  chipType?: string;
  warranty?: string;
  warrantyDays?: number;
  /** Campos privados: sólo se cargan a través de la API administrativa. */
  costPrice?: number;
  marginPercentage?: number;
  stock?: number;
  stockMin?: number;
};

export type VehicleCategory = {
  id: string;
  title: string;
  description: string;
  image: string;
  href: string;
  active: boolean;
};

export type NeedCategory = {
  title: string;
  description: string;
  icon: string;
  href: string;
};

export type Reason = {
  title: string;
  text: string;
};

export type Promotion = {
  id: string;
  title: string;
  description: string;
  image: string;
  ctaText: string;
  ctaHref: string;
  price?: string;
  startDate?: string;
  endDate?: string;
  active: boolean;
  order: number;
};

export type SiteSettings = {
  themePreset: ThemePreset;
  logo: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  email: string;
  phone: string;
  address: string;
  heroTitle: string;
  heroSubtitle: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  heroImage: string;
  vehicleSectionTitle: string;
  needsSectionTitle: string;
  whyUsSectionTitle: string;
  productsSectionTitle: string;
  promotionsSectionTitle: string;
  radioEnabled: boolean;
  radioShowPlayer: boolean;
  radioName: string;
  radioStreamUrl: string;
  radioSubtitle: string;
  transferAlias: string;
  transferCbuCvu: string;
  transferHolder: string;
  transferInstitution: string;
  transferInstructions: string;
};

export type SiteContent = {
  products: Product[];
  promotions: Promotion[];
  vehicleCategories: VehicleCategory[];
  siteSettings: SiteSettings;
};

export const needCategories: NeedCategory[] = [
  {
    title: "LED para ópticas",
    description: "Soluciones para iluminación principal y mejor visibilidad nocturna.",
    icon: "◉",
    href: "/productos",
  },
  {
    title: "Antiniebla",
    description: "Mayor claridad en condiciones adversas y baja visibilidad.",
    icon: "✦",
    href: "/productos",
  },
  {
    title: "Proyectores",
    description: "Potencia y alcance para rutas, trabajo y uso diario.",
    icon: "▣",
    href: "/productos",
  },
  {
    title: "Iluminación auxiliar",
    description: "Cobertura extra para explorar, trabajar o recorrer con confianza.",
    icon: "◌",
    href: "/productos",
  },
  {
    title: "Motos",
    description: "Opciones pensadas para mayor rendimiento y estilo en motos.",
    icon: "⚡",
    href: "/productos",
  },
];

export const reasons: Reason[] = [
  { title: "ILUMINACIÓN", text: "Opciones pensadas para mejorar la iluminación de tu vehículo." },
  { title: "COMPATIBILIDAD", text: "Te ayudamos a encontrar la opción adecuada para tu vehículo." },
  { title: "ASESORAMIENTO", text: "Consultanos antes de comprar." },
  { title: "PARA TU VEHÍCULO", text: "Opciones para autos, camionetas, motos y vehículos de trabajo." },
];

export const defaultSiteContent: SiteContent = {
  siteSettings: {
    themePreset: DEFAULT_THEME,
    logo: "/brand/logo-dcl.png.png",
    whatsapp: whatsappUrl("Hola DCL Cree LED, quiero consultar por iluminación para mi vehículo."),
    instagram: "https://instagram.com",
    facebook: "https://facebook.com",
    email: "ventas@dclcreeled.com.ar",
    phone: "+54 9 11 0000-0000",
    address: "Argentina",
    heroTitle: "ILUMINÁ MEJOR. CONDUCÍ MEJOR.",
    heroSubtitle: "Iluminación LED de alto rendimiento para autos, camionetas, motos y vehículos de trabajo.",
    heroPrimaryCta: "ENCONTRÁ EL LED PARA MI VEHÍCULO",
    heroSecondaryCta: "VER PRODUCTOS",
    heroImage: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80",
    vehicleSectionTitle: "¿QUÉ VEHÍCULO TENÉS?",
    needsSectionTitle: "¿QUÉ ESTÁS BUSCANDO?",
    whyUsSectionTitle: "¿POR QUÉ DCL?",
    productsSectionTitle: "PRODUCTOS DESTACADOS",
    promotionsSectionTitle: "PROMOCIONES DCL",
    radioEnabled: true,
    radioShowPlayer: true,
    radioName: "La Nueva",
    radioStreamUrl: "https://stream.zeno.fm/owdfrxtingytv",
    radioSubtitle: "Música mientras elegís tus Cree LED",
    transferAlias: "",
    transferCbuCvu: "",
    transferHolder: "",
    transferInstitution: "",
    transferInstructions: "Enviá el comprobante por WhatsApp indicando el número de pedido.",
  },
  vehicleCategories: [
    { id: "auto", title: "Auto", description: "Iluminación para tu auto.", image: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=80", href: "/vehiculos", active: true },
    { id: "camioneta", title: "Camioneta", description: "Iluminación para tu camioneta.", image: "https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=900&q=80", href: "/vehiculos", active: true },
    { id: "moto", title: "Moto", description: "Iluminación para tu moto.", image: "https://images.unsplash.com/photo-1558980664-10e7170b5df9?auto=format&fit=crop&w=900&q=80", href: "/vehiculos", active: true },
    { id: "camion", title: "Camión", description: "Iluminación para tu camión.", image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80", href: "/vehiculos", active: true },
  ],
  products: [
    {
      id: "s6-hd",
      name: "S6 HD",
      description: "Luz de alto rendimiento para mejorar la visibilidad y el estilo.",
      price: 68999,
      previousPrice: 74999,
      image: "https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?auto=format&fit=crop&w=900&q=80",
      category: "Ópticas",
      featured: true,
      active: true,
      showInCatalog: true,
      href: "/productos/s6-hd",
      ctaText: "VER PRODUCTO",
      order: 1,
    },
    {
      id: "f4-24v",
      name: "F4 24V",
      description: "Solución pensada para aplicaciones de uso exigente y continuidad.",
      price: 57999,
      image: "https://images.unsplash.com/photo-1489824904134-891ab64532f1?auto=format&fit=crop&w=900&q=80",
      category: "Proyectores",
      featured: true,
      active: true,
      showInCatalog: true,
      href: "/productos/f4-24v",
      ctaText: "VER PRODUCTO",
      order: 2,
    },
    {
      id: "ir100",
      name: "IR100",
      description: "Diseño orientado a rendimiento y presencia en la vía.",
      price: 49999,
      image: "https://images.unsplash.com/photo-1494905998402-395d579af36f?auto=format&fit=crop&w=900&q=80",
      category: "Spotlights",
      featured: true,
      active: true,
      showInCatalog: true,
      href: "/productos/ir100",
      ctaText: "VER PRODUCTO",
      order: 3,
    },
    {
      id: "kb3-premium",
      name: "KB3 Premium",
      description: "Línea premium para quienes buscan un equilibrio entre luz y estilo.",
      price: 65999,
      image: "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=900&q=80",
      category: "Premium",
      featured: true,
      active: true,
      showInCatalog: true,
      href: "/productos/kb3-premium",
      ctaText: "VER PRODUCTO",
      order: 4,
    },
    {
      id: "irx-dakar",
      name: "IRX Dakar",
      description: "Propuesta con fuerte presencia visual y foco en la experiencia de conducción.",
      price: 72999,
      image: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=900&q=80",
      category: "Modelos Offroad",
      featured: false,
      active: true,
      showInCatalog: true,
      href: "/productos/irx-dakar",
      ctaText: "VER PRODUCTO",
      order: 5,
    },
  ],
  promotions: [
    {
      id: "combo-iluminacion",
      title: "Combo de iluminación",
      description: "Preparado para acompañar tu próxima compra.",
      image: "https://images.unsplash.com/photo-1493375366763-3ed5e0e6d8ec?auto=format&fit=crop&w=900&q=80",
      ctaText: "CONSULTAR",
      ctaHref: whatsappUrl("Hola DCL Cree LED, quiero consultar por el combo de iluminación."),
      price: "$68.999",
      active: true,
      order: 1,
    },
    {
      id: "oferta-destacada",
      title: "Oferta destacada",
      description: "Próximamente nuevas promociones para vehículos y accesorios.",
      image: "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=900&q=80",
      ctaText: "VER OFERTA",
      ctaHref: whatsappUrl("Hola DCL Cree LED, quiero consultar por la oferta destacada."),
      active: true,
      order: 2,
    },
    {
      id: "lanzamientos",
      title: "Lanzamientos",
      description: "Nuevas opciones para ir viendo en la próxima temporada.",
      image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80",
      ctaText: "CONSULTAR",
      ctaHref: whatsappUrl("Hola DCL Cree LED, quiero consultar por los lanzamientos."),
      active: true,
      order: 3,
    },
  ],
};
