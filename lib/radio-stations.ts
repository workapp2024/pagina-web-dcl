export type RadioStation = {
  id: string;
  name: string;
  genre: string;
  streamUrl: string;
  coverUrl?: string;
  description: string;
  active: boolean;
  featured: boolean;
  sortOrder: number;
};

export const DEFAULT_RADIO_STATION: RadioStation = {
  id: "dcl-music-default",
  name: "La Nueva",
  genre: "Variados",
  streamUrl: "https://stream.zeno.fm/owdfrxtingytv",
  description: "Música gratis para acompañarte en el camino.",
  active: true,
  featured: true,
  sortOrder: 0,
};

export const DCL_MUSIC_SELECT_EVENT = "dcl-music:select-station";

export function selectRadioStation(station: RadioStation) {
  window.dispatchEvent(new CustomEvent<RadioStation>(DCL_MUSIC_SELECT_EVENT, { detail: station }));
}
