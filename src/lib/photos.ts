// Real photos used in the owner app. All are free to use under the Pexels and Unsplash licenses
// and are loaded from their image servers. Credits are shown on each photo.
import type { FindingKind, Yacht } from './yacht';

export interface Photo { src: string; credit: string; alt: string; pos?: string }

const pexels = (id: number, w = 1200, file?: string) =>
  `https://images.pexels.com/photos/${id}/${file ?? `pexels-photo-${id}.jpeg`}?auto=compress&cs=tinysrgb&w=${w}`;
const unsplash = (id: string, w = 1200) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const YACHT_PHOTOS: Photo[] = [
  { src: pexels(21739957), credit: 'Matteo Roman / Pexels', alt: 'A motor yacht cruising in turquoise water off Hurghada' },
  { src: pexels(15564496), credit: 'Diego F. Parra / Pexels', alt: 'A white motor yacht on a calm, clear sea' },
  { src: pexels(30710213), credit: 'Saksham Vikram / Pexels', alt: 'A luxury yacht on calm blue water' },
  { src: unsplash('photo-1605281317010-fe5ffe798166'), credit: 'Alina Kacharho / Unsplash', alt: 'A white and blue yacht at sea' },
  { src: unsplash('photo-1622219969983-45589eae5637'), credit: 'Damian Barczak / Unsplash', alt: 'A yacht moored at a dock at sunset' },
];

export const yachtPhoto = (y: Yacht) => YACHT_PHOTOS[y.seed % YACHT_PHOTOS.length];

export const MARINA_PHOTO: Photo = { src: pexels(18614692), credit: 'Bassel Zaki / Pexels', alt: 'Yachts moored in Hurghada Marina at sunset' };
export const REDSEA_PHOTO: Photo = { src: pexels(22643843, 900), credit: 'Mo Ismail / Pexels', alt: 'The Red Sea coast near Hurghada at sunset' };
export const YARD_PHOTO: Photo = { src: pexels(2867978), credit: 'Pexels', alt: 'Boats in a repair yard in Hurghada' };
export const DIVER_PHOTO: Photo = { src: unsplash('photo-1578403881636-6f4a77a6f9cc', 600), credit: 'NOAA / Unsplash', alt: 'A diver underwater' };

export const FINDING_PHOTOS: Record<FindingKind, Photo> = {
  intake: { src: unsplash('photo-1787672807751-273da52914e8'), credit: 'Barney Goodman / Unsplash', alt: 'A hull crusted with barnacles' },
  propeller: { src: pexels(8669061), credit: 'Stuart Reece / Pexels', alt: 'Close-up of boat propellers' },
  rope: { src: pexels(29576317), credit: 'Pexels', alt: 'Rope covered in growth hanging on metal bars' },
  scrape: { src: pexels(37385856), credit: 'Jan van der Wolf / Pexels', alt: 'Worn paint on the underside of a boat hull' },
  blisters: { src: pexels(16556290), credit: 'Mark Henry Rood / Pexels', alt: 'Close-up of a damaged boat hull surface' },
  paint: { src: unsplash('photo-1792497691144-84fec0c788d8'), credit: 'Vadim Yefremov / Unsplash', alt: 'Peeling paint on a boat hull' },
};
